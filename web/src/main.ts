/**
 * The claim page.
 *
 * One screen, four stages: connect, check eligibility, claim, confirmed. Every stage
 * is a value of `State.stage`, and `render` is a pure function of that state, so what
 * you see always matches what the page believes.
 *
 * Each token gets its own generated card. Before claiming, the page shows the six
 * designs a card can have. After claiming, it displays the image from tokenURI.
 *
 * Two rules shape the whole file:
 *   1. Eligibility is confirmed against the contract, never from proofs.json alone.
 *   2. The user is never shown a stack trace. Details go to the console.
 */
import type {Address, Hex} from "viem";

import "./style.css";
// The exact bytes the contract stores, so the preview cannot disagree with the token.
import courseArtwork from "../../nft/course-nft-onchain.webp";

import {designs, type Card} from "./card";
import {mountSlideshow, slideshowHtml} from "./slideshow";
import {
  CHAIN_ID,
  CONTRACT_ADDRESS,
  COURSE,
  DEPLOYMENT,
  NETWORK,
  WALLET_DOWNLOAD,
  explorerAddress,
  explorerTx
} from "./config";
import {proofFor, publishedRoot} from "./allowlist";
import {explain, type FriendlyError} from "./errors";
import {
  balanceOf,
  findClaimedTokenId,
  isEligibleOnChain,
  readContractState,
  readToken,
  readTotalMinted,
  submitClaim,
  waitForClaim,
  type OwnedToken
} from "./contract";
import {
  connectedAccount,
  currentChainId,
  hasWallet,
  onWalletChange,
  requestAccount,
  switchToTargetChain,
  walletClient
} from "./wallet";

type Stage =
  | "no-wallet"
  | "not-deployed"
  | "disconnected"
  | "connecting"
  | "wrong-network"
  | "needs-gas"
  | "checking"
  | "eligible"
  | "not-eligible"
  | "claim-closed"
  | "awaiting-signature"
  | "pending"
  | "claimed";

interface State {
  stage: Stage;
  account?: Address;
  wrongChainId?: number;
  proof?: Hex[];
  txHash?: Hex;
  token?: OwnedToken;
  artworkLoading?: boolean;
  /** Tokens minted so far. Token ids are claim order, so this is the queue length. */
  totalMinted?: bigint;
  /** False when the contract lets anyone claim, so the panel can say so. */
  allowlistEnabled?: boolean;
  /** True once a submitted transaction has been outstanding long enough to mention. */
  slow?: boolean;
  /** A recoverable problem, shown as a banner without discarding the current stage. */
  notice?: FriendlyError;
}

/**
 * Enough native currency to be confident the claim will go through. A claim costs
 * roughly 150k gas; this is a generous floor, not a precise estimate.
 */
const COMFORTABLE_GAS_WEI = 1_000_000_000_000_000n; // 0.001 ETH

const root = document.querySelector<HTMLElement>("#app")!;
let state: State = {stage: "disconnected"};
let pendingTimer: number | undefined;
let countTimer: number | undefined;

/**
 * Bumped whenever the page starts working out a wallet's situation afresh. An async
 * step that finds it changed while it waited drops its result: the page has moved
 * on, perhaps to another wallet, and the old answer would be shown for the new one.
 */
let generation = 0;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!
  );
}

/** 1 -> "1st", 12 -> "12th", 23 -> "23rd". Used to say where in the queue a wallet landed. */
function ordinal(n: bigint | number): string {
  const value = Number(n);
  const lastTwo = value % 100;
  const suffix =
    lastTwo >= 11 && lastTwo <= 13
      ? "th"
      : ({1: "st", 2: "nd", 3: "rd"}[value % 10] ?? "th");
  return `${value}${suffix}`;
}

function shorten(value: string, lead = 6, tail = 4): string {
  return value.length <= lead + tail + 2 ? value : `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

function setState(patch: Partial<State>): void {
  state = {...state, ...patch};
  render();
}

/**
 * Move to a stage and drop anything left over from the previous one.
 *
 * The account, the claim count and what is known about the contract and its artwork
 * survive: they describe the world rather than the current step.
 */
function goto(stage: Stage, patch: Partial<State> = {}): void {
  window.clearTimeout(pendingTimer);
  const {account, totalMinted} = state;
  state = {stage, account, totalMinted, ...patch};
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STEP_OF: Record<Stage, number> = {
  "no-wallet": 0,
  "not-deployed": 1,
  disconnected: 1,
  connecting: 1,
  "wrong-network": 1,
  "needs-gas": 1,
  checking: 2,
  "not-eligible": 2,
  "claim-closed": 2,
  eligible: 3,
  "awaiting-signature": 3,
  pending: 3,
  claimed: 4
};

const STEP_LABELS = [
  "Set Up Wallet",
  "Connect Wallet",
  "Check Eligibility",
  "Claim NFT",
  "Confirmed"
];

function stepper(current: number): string {
  const items = STEP_LABELS.map((label, i) => {
    const status = i < current ? "done" : i === current ? "current" : "todo";
    return `<li data-state="${status}"><span class="n">${i < current ? "&#10003;" : i + 1}</span>${label}</li>`;
  }).join("");
  return `<ol class="steps">${items}</ol>`;
}

function statusBlock(
  tone: "info" | "good" | "warn" | "bad",
  title: string,
  body?: string,
  options: {spinner?: boolean; detail?: string} = {}
): string {
  return `<div class="status ${tone}">
    ${options.spinner ? '<div class="spinner" aria-hidden="true"></div>' : ""}
    <div><strong>${escapeHtml(title)}</strong>${body ? escapeHtml(body) : ""}${
      options.detail ? `<span class="detail mono">${escapeHtml(options.detail)}</span>` : ""
    }</div>
  </div>`;
}

function noticeBlock(): string {
  if (!state.notice) return "";
  return statusBlock("bad", state.notice.message, undefined, {detail: state.notice.detail});
}

function walletRow(): string {
  if (!state.account) return "";
  return `<dl class="rows"><div><dt>Wallet</dt><dd class="mono">${shorten(state.account)}</dd></div></dl>`;
}

/** The claim panel: whatever the current stage needs the user to see or do. */
function panel(): string {
  switch (state.stage) {
    case "no-wallet":
      return `<h2>Set up a wallet</h2>
        <p class="lede">
          No Ethereum wallet detected in this browser. Three one-time steps, and you
          only ever do them once.
        </p>
        <ol class="setup">
          <li>
            <strong>Install MetaMask.</strong>
            Works in Chrome, Firefox, Edge and Brave. Create a new wallet when it asks,
            and keep the recovery phrase somewhere safe.
            <a href="${WALLET_DOWNLOAD}" target="_blank" rel="noopener noreferrer">Download MetaMask</a>
          </li>
          <li>
            <strong>Switch to ${escapeHtml(NETWORK.label)}.</strong>
            A test network, so nothing here costs real money. Come back and connect, and
            this page will offer to switch for you.
          </li>
          <li>
            <strong>Get free test ETH.</strong>
            Claiming is free, but Ethereum charges a small fee to process any transaction.
            ${
              NETWORK.faucet
                ? `Any ${escapeHtml(NETWORK.label)} faucet works, for example:
            <a class="url" href="${NETWORK.faucet}" target="_blank" rel="noopener noreferrer">${escapeHtml(NETWORK.faucet)}</a>`
                : ""
            }
          </li>
        </ol>
        <button class="primary" id="reload">I have installed a wallet</button>`;

    case "not-deployed":
      return `<h2>Not deployed yet</h2>
        <p class="lede">The claim contract has not been published to ${escapeHtml(NETWORK.label)}.</p>
        ${statusBlock(
          "info",
          "Nothing to claim yet",
          "Once the course staff deploy the contract and rebuild this page, the claim button appears here."
        )}`;

    case "disconnected":
    case "connecting": {
      const busy = state.stage === "connecting";
      return `<h2>Claim your course NFT</h2>
        ${DEPLOYMENT.onchainCards ? '<p class="lede">Six base designs. Your card adds an accent, a symbol and your claim number.</p>' : ""}
        <p class="lede">Connect a wallet to check whether you are on the allowlist.</p>
        ${noticeBlock()}
        ${busy ? statusBlock("info", "Waiting for your wallet...", "Approve the connection request.", {spinner: true}) : ""}
        <button class="primary" id="connect" ${busy ? "disabled" : ""}>
          ${busy ? "Connecting..." : "Connect Wallet"}
        </button>`;
    }

    case "wrong-network":
      return `<h2>Wrong network</h2>
        ${walletRow()}
        ${noticeBlock()}
        ${statusBlock(
          "warn",
          "Wrong network",
          `This wallet is on chain ${state.wrongChainId}. The course NFT lives on ${NETWORK.label} (chain ${CHAIN_ID}).`
        )}
        <button class="primary" id="switch">Switch to ${escapeHtml(NETWORK.label)}</button>`;

    case "needs-gas":
      return `<h2>You need test ETH</h2>
        ${walletRow()}
        ${noticeBlock()}
        ${statusBlock(
          "warn",
          `This wallet holds no ${escapeHtml(NETWORK.chain.nativeCurrency.symbol)} on ${escapeHtml(NETWORK.label)}`,
          "The NFT is free, but Ethereum charges a small fee to process the claim. Test ETH costs nothing: paste your address into the faucet below, then check again."
        )}
        <div class="addressbox">
          <span>Your address</span>
          <code>${escapeHtml(state.account ?? "")}</code>
          <button class="secondary" id="copy" data-address="${escapeHtml(state.account ?? "")}">Copy address</button>
        </div>
        ${
          NETWORK.faucet
            ? `<div class="links"><a href="${NETWORK.faucet}" target="_blank" rel="noopener noreferrer">Open the Sepolia faucet</a></div>`
            : ""
        }
        <button class="secondary" id="recheck">Check again</button>`;

    case "checking":
      return `<h2>Checking eligibility</h2>
        ${walletRow()}
        ${statusBlock("info", "Checking eligibility...", "Reading the allowlist and asking the contract.", {spinner: true})}`;

    case "not-eligible":
      return `<h2>Not eligible</h2>
        ${walletRow()}
        ${noticeBlock()}
        ${statusBlock(
          "warn",
          "This wallet is not eligible",
          "It is not on the current allowlist. If you are enrolled, send your address to the course staff and try again after the roster is updated."
        )}`;

    case "claim-closed":
      return `<h2>Claiming is closed</h2>
        ${walletRow()}
        ${statusBlock("warn", "Claiming is currently closed", "The course staff have paused new claims.")}`;

    case "eligible": {
      const next = (state.totalMinted ?? 0n) + 1n;
      const who = state.allowlistEnabled === false ? "Open to anyone, one NFT per wallet." : "One NFT per wallet.";
      const art = DEPLOYMENT.onchainCards
        ? "Your address and final claim number determine your card. The number is assigned when the transaction is confirmed."
        : "Your claim number is minted into the artwork itself.";
      return `<h2>You are eligible</h2>
        ${walletRow()}
        ${noticeBlock()}
        ${statusBlock("good", `Next available claim: ${ordinal(next)}`, `${who} ${art}`)}
        <button class="primary" id="claim">Claim Course NFT</button>`;
    }

    case "awaiting-signature":
      return `<h2>Confirm in your wallet</h2>
        ${walletRow()}
        ${statusBlock("info", "Waiting for wallet confirmation...", "Approve or reject the transaction in your wallet.", {spinner: true})}
        <button class="secondary" id="cancel">Cancel</button>`;

    case "pending": {
      const link = state.txHash ? explorerTx(state.txHash) : null;
      return `<h2>Transaction submitted</h2>
        ${walletRow()}
        <dl class="rows"><div><dt>Transaction</dt><dd class="mono">${shorten(state.txHash ?? "", 10, 8)}</dd></div></dl>
        ${statusBlock("info", "Waiting for block confirmation...", "This usually takes a few seconds.", {spinner: true})}
        ${state.slow ? statusBlock("warn", "Still pending", "The transaction has not been mined yet. It is safe to leave this page open, or check it on the explorer.") : ""}
        ${link ? `<div class="links"><a href="${link}" target="_blank" rel="noopener noreferrer">View transaction</a></div>` : ""}`;
    }

    case "claimed": {
      const token = state.token;
      const tokenId = token?.tokenId;
      // Tokens are transferable, so the claimer and the current holder can differ.
      const holder = token?.owner;
      const stillHeld = !holder || !state.account || holder.toLowerCase() === state.account.toLowerCase();
      const card = readyCard();
      const txLink = state.txHash ? explorerTx(state.txHash) : null;
      const contractLink = CONTRACT_ADDRESS ? explorerAddress(CONTRACT_ADDRESS) : null;
      return `<h2>NFT claimed!</h2>
        <p class="lede">${escapeHtml(COURSE.code)} &mdash; ${escapeHtml(COURSE.term)}</p>
        ${noticeBlock()}
        ${statusBlock(
          stillHeld ? "good" : "info",
          tokenId === undefined
            ? "This wallet has already claimed its course NFT"
            : `You were the ${ordinal(tokenId)} to claim`,
          !stillHeld
            ? "This token has since been transferred to another address. The claim record is permanent either way."
            : DEPLOYMENT.onchainCards
              ? "Your final card is stored on-chain and ready to view in your wallet."
              : "This deployment uses the earlier artwork. The image below is what its contract currently returns."
        )}
        <dl class="rows">
          <div><dt>Token</dt><dd class="mono">#${tokenId ?? "?"}</dd></div>
          ${
            tokenId === undefined
              ? ""
              : `<div><dt>Claim order</dt><dd>${escapeHtml(ordinal(tokenId))}${
                  state.totalMinted ? ` of ${state.totalMinted} so far` : ""
                }</dd></div>`
          }
          <div><dt>Owner</dt><dd class="mono">${holder ? shorten(holder) : "Unavailable"}</dd></div>
        </dl>
        ${card ? traitList(card) : ""}
        ${tokenId !== undefined ? `<details class="wallet-import"><summary>Show in my wallet</summary>
          <p>In your wallet, choose Import NFT on ${escapeHtml(NETWORK.label)}.</p>
          <p>Contract: <span class="mono">${escapeHtml(CONTRACT_ADDRESS ?? "")}</span>
            <button class="text-button" id="copy-contract">Copy</button></p>
          <p>Token ID: <strong>${tokenId}</strong></p>
          <p>Enable NFT media if the image is hidden. Detection and refresh times depend on your wallet.</p>
        </details>` : ""}
        <div class="links">
          ${card ? `<a href="${card.image}" download="${escapeHtml(card.fileName)}">Download image</a>` : ""}
          ${txLink ? `<a href="${txLink}" target="_blank" rel="noopener noreferrer">View transaction</a>` : ""}
          ${contractLink ? `<a href="${contractLink}" target="_blank" rel="noopener noreferrer">View contract</a>` : ""}
        </div>`;
    }
  }
}

function readyCard(): Card | undefined {
  return state.token?.card;
}

function traitList(card: Card): string {
  const visible = new Set(["Base Template", "Accent", "Symbol", "Orbit"]);
  const items = card.traits.filter(trait => visible.has(trait.label)).map(
    ({label, value}) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join("");
  return items ? `<dl class="traits" aria-label="Card traits">${items}</dl>` : "";
}

function artwork(): string {
  if (state.stage === "claimed") {
    const card = readyCard();
    if (card) return `<figure class="card art">
      <img src="${card.image}" alt="${escapeHtml(card.name)}" width="1254" height="1254" />
      <figcaption>Your NFT image, read directly from the contract</figcaption>
    </figure>`;
    const loading = state.artworkLoading === true;
    return `<figure class="card art"><div class="pending-card stack" aria-busy="${loading}">
      ${loading
        ? statusBlock("info", "Loading your NFT image...", undefined, {spinner: true})
        : statusBlock("warn", state.token?.artworkError ?? "Your NFT is claimed. Reload its image to view it here.")}
      <button class="secondary" id="redraw" ${loading ? "disabled" : ""}>${loading ? "Loading..." : "Reload image"}</button>
    </div></figure>`;
  }
  if (DEPLOYMENT.onchainCards) {
    return `<figure class="card art">${slideshowHtml(designs, escapeHtml, DEPLOYMENT.designWeights)}</figure>`;
  }
  return `<figure class="card art"><img src="${courseArtwork}" alt="Course NFT artwork" />
    <figcaption>Artwork from the currently configured deployment</figcaption></figure>`;
}

function chainbar(): string {
  const address = CONTRACT_ADDRESS
    ? `<span class="mono">${shorten(CONTRACT_ADDRESS, 10, 8)}</span>`
    : "<span>not deployed</span>";
  const link = CONTRACT_ADDRESS ? explorerAddress(CONTRACT_ADDRESS) : null;
  const claimed =
    state.totalMinted === undefined
      ? ""
      : `<div>Claimed so far <span>${state.totalMinted}</span></div>`;
  return `<div class="chainbar">
    <div>Network <span>${escapeHtml(NETWORK.label)}</span> (chain ${CHAIN_ID})</div>
    ${claimed}
    <div>Contract ${link ? `<a class="mono" href="${link}" target="_blank" rel="noopener noreferrer">${shorten(CONTRACT_ADDRESS!, 10, 8)}</a>` : address}</div>
  </div>`;
}

/** The HTML each region last received, so a region whose content is unchanged is left alone. */
const rendered = new Map<string, string>();

/**
 * Write each region that changed. Leaving the others untouched keeps whatever the
 * visitor is doing there, such as which design the slideshow is on, across the
 * count poll's re-renders.
 */
function render(): void {
  if (!root.querySelector("[data-region]")) {
    root.innerHTML = `
      <header class="masthead">
        <h1>${escapeHtml(COURSE.code)}</h1>
        <p>${escapeHtml(COURSE.title)}</p>
        <div class="term">${escapeHtml(COURSE.term)}</div>
      </header>
      <div data-region="steps"></div>
      <div class="grid">
        <div data-region="art"></div>
        <section class="card stack" data-region="panel"></section>
      </div>
      <div data-region="chain"></div>
      <p class="disclaimer">
        &copy; Yale ${escapeHtml(COURSE.code)},
        <a href="${COURSE.site}" target="_blank" rel="noopener noreferrer">${escapeHtml(COURSE.site)}</a>
      </p>
    `;
    rendered.clear();
  }

  region("steps", stepper(STEP_OF[state.stage]));
  const art = region("art", artwork());
  if (art) mountSlideshow(art);
  region("panel", panel());
  region("chain", chainbar());
}

/** Replace a region's content if it differs from last time. Returns the region if it did. */
function region(name: string, html: string): HTMLElement | null {
  if (rendered.get(name) === html) return null;
  const element = root.querySelector<HTMLElement>(`[data-region="${name}"]`)!;
  element.innerHTML = html;
  rendered.set(name, html);
  return element;
}

/** Every button with an id is handled here, so re-rendered buttons need no rebinding. */
const ACTIONS: Record<string, () => void> = {
  reload: () => window.location.reload(),
  copy: () => void copyAddress(),
  recheck: () => void refresh(),
  connect: () => void connect(),
  switch: () => void switchNetwork(),
  claim: () => void claim(),
  cancel: () => void refresh(),
  redraw: () => void reloadArtwork(),
  "copy-contract": () => { if (CONTRACT_ADDRESS) void navigator.clipboard.writeText(CONTRACT_ADDRESS).catch(() => {}); }
};

// A property rather than addEventListener: there is exactly one page handler.
root.onclick = (event) => {
  const button = (event.target as Element | null)?.closest<HTMLButtonElement>("button[id]");
  if (button && !button.disabled) ACTIONS[button.id]?.();
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Copying beats retyping 42 hex characters into a faucet form. */
async function copyAddress(): Promise<void> {
  const button = document.getElementById("copy") as HTMLButtonElement | null;
  const address = button?.dataset.address;
  if (!button || !address) return;

  try {
    await navigator.clipboard.writeText(address);
    button.textContent = "Copied";
  } catch (error) {
    console.debug("clipboard unavailable", error);
    button.textContent = "Select it above and copy";
  }
  window.setTimeout(() => {
    if (document.getElementById("copy") === button) button.textContent = "Copy address";
  }, 2000);
}

async function connect(): Promise<void> {
  goto("connecting");
  try {
    const account = await requestAccount();
    setState({account});
    await refresh();
  } catch (error) {
    goto("disconnected", {notice: explain(error, "Could not connect to your wallet.")});
  }
}

async function switchNetwork(): Promise<void> {
  try {
    await switchToTargetChain();
    await refresh();
  } catch (error) {
    setState({notice: explain(error, `Could not switch to ${NETWORK.label}.`)});
  }
}

/**
 * Work out, from scratch, what this wallet's situation is.
 *
 * Called on load, after connecting, after a network switch, and whenever the wallet
 * reports that the account or chain changed. Deriving the stage rather than tracking
 * it incrementally is what makes the already-claimed view survive a page reload.
 */
async function refresh(): Promise<void> {
  const run = ++generation;
  const stale = () => run !== generation;
  const account = state.account ?? (await connectedAccount());
  if (stale()) return;
  if (!account) {
    goto("disconnected");
    return;
  }

  goto("checking", {account});

  try {
    const chainId = await currentChainId();
    if (stale()) return;
    if (chainId !== CHAIN_ID) {
      goto("wrong-network", {account, wrongChainId: chainId});
      return;
    }

    const [contractState, balance] = await Promise.all([
      readContractState(account),
      balanceOf(account)
    ]);
    if (stale()) return;
    const {allowlistEnabled, totalMinted} = contractState;
    // Facts about the contract, kept across stages by `goto`.
    state = {...state, totalMinted};

    // Already claimed in this or an earlier session: rebuild the success view from chain state.
    if (contractState.hasClaimed) {
      await showOwnedToken(account, run);
      return;
    }

    if (!contractState.claimOpen) {
      goto("claim-closed", {account, allowlistEnabled});
      return;
    }

    // With the allowlist off the contract accepts any address, so proofs.json is not
    // fetched at all: it may not even have been published.
    let proof: Hex[] = [];

    if (allowlistEnabled) {
      const found = await proofFor(account);
      if (stale()) return;
      if (!found) {
        goto("not-eligible", {account, allowlistEnabled});
        return;
      }

      // proofs.json says yes. Only the contract's answer decides whether we offer a button.
      const eligible = await isEligibleOnChain(account, found);
      if (stale()) return;
      if (!eligible) {
        const root = await publishedRoot().catch(() => null);
        if (stale()) return;
        const outdated = root && root.toLowerCase() !== contractState.merkleRoot.toLowerCase();
        goto("not-eligible", {
          account,
          allowlistEnabled,
          notice: outdated
            ? {
                message: "This page is showing an out-of-date allowlist.",
                detail: "The published Merkle root does not match the contract. Ask the course staff to rebuild the site."
              }
            : undefined
        });
        return;
      }

      proof = found;
    }

    // Only ask for gas money from someone who is actually about to spend it. A
    // student who already claimed, or who is not on the list, needs none.
    if (balance === 0n) {
      goto("needs-gas", {account, allowlistEnabled});
      return;
    }

    goto("eligible", {
      account,
      proof,
      allowlistEnabled,
      notice:
        balance < COMFORTABLE_GAS_WEI
          ? {
              message: "This wallet is very low on test ETH.",
              detail: "The claim may fail for lack of gas. Top up from the faucet if it does."
            }
          : undefined
    });
  } catch (error) {
    if (stale()) return;
    goto("disconnected", {
      account,
      notice: explain(error, "Could not reach the network. Check your connection and try again.")
    });
  }
}

async function showOwnedToken(account: Address, run: number): Promise<void> {
  const stale = () => run !== generation;
  // Keep a token learned from a receipt or earlier lookup, even if a later read
  // fails. Reloading an image should never redo eligibility or claim discovery.
  goto("claimed", {account, token: state.token, txHash: state.txHash, artworkLoading: true});
  try {
    const tokenId = state.token?.tokenId ?? await findClaimedTokenId(account, state.totalMinted);
    if (stale()) return;
    if (tokenId === null) {
      throw new Error("The claim is confirmed, but its token could not be found. Please retry.");
    }
    setState({token: state.token ?? {tokenId}});
    const token = await readToken(tokenId);
    if (stale()) return;
    setState({token, artworkLoading: false});
  } catch (error) {
    if (stale()) return;
    setState({
      artworkLoading: false,
      notice: explain(error, "Your NFT is claimed, but its image could not be loaded right now. Please retry.")
    });
  }
}

async function reloadArtwork(): Promise<void> {
  if (state.stage !== "claimed" || !state.account || state.artworkLoading) return;
  await showOwnedToken(state.account, ++generation);
}

async function claim(): Promise<void> {
  const {account, proof} = state;
  if (!account || !proof) return;
  const sameWallet = () => state.account?.toLowerCase() === account.toLowerCase();

  goto("awaiting-signature", {account, proof});

  let hash: Hex;
  try {
    hash = await submitClaim(account, proof, walletClient(account));
  } catch (error) {
    // Cancel, or a switch to another wallet, has already moved the page on.
    if (state.stage !== "awaiting-signature" || !sameWallet()) return;
    goto("eligible", {account, proof, notice: explain(error, "The claim could not be submitted.")});
    return;
  }

  // The claim is sent. Unless the page has moved to another wallet meanwhile, it is the
  // newest thing the page knows, and it supersedes any check still running from Cancel.
  if (!sameWallet()) return;
  const run = ++generation;
  const stale = () => run !== generation;

  goto("pending", {account, proof, txHash: hash});
  // "Transaction remains pending" is a state the page has to be honest about.
  pendingTimer = window.setTimeout(() => {
    if (state.stage === "pending") setState({slow: true});
  }, 45_000);

  try {
    const tokenId = await waitForClaim(hash);
    if (stale()) return;
    // This claim is the newest, so the count is at least this token's number.
    if (state.totalMinted === undefined || state.totalMinted < tokenId) state = {...state, totalMinted: tokenId};
    goto("claimed", {account, txHash: hash, token: {tokenId, owner: account}});
    await showOwnedToken(account, run);
  } catch (error) {
    if (stale()) return;
    goto("eligible", {account, proof, notice: explain(error, "The transaction did not complete successfully.")});
  }
}

// ---------------------------------------------------------------------------
// Live claim count
// ---------------------------------------------------------------------------

/**
 * Keep the claim count fresh while the page is open.
 *
 * Only `totalMinted` is re-read, and the page only re-renders when the number
 * actually moves, so a quiet page costs one `eth_call` per tick and no DOM work.
 * The whole stage is never re-derived here: that would fight with whatever the
 * student is in the middle of doing.
 */
function startCountPolling(): void {
  stopCountPolling();
  if (!CONTRACT_ADDRESS) return;

  countTimer = window.setInterval(async () => {
    // Nothing to show, and nothing safe to read, before a wallet is on the right chain.
    if (document.hidden || !state.account || state.stage === "wrong-network") return;

    try {
      const latest = await readTotalMinted();
      if (latest !== state.totalMinted) setState({totalMinted: latest});
    } catch (error) {
      // A transient RPC failure should not disturb the page. It will retry next tick.
      console.debug("claim count poll failed", error);
    }
  }, NETWORK.pollIntervalMs);
}

async function refreshCount(): Promise<void> {
  try {
    const latest = await readTotalMinted();
    if (latest !== state.totalMinted) setState({totalMinted: latest});
  } catch (error) {
    console.debug("claim count refresh failed", error);
  }
}

function stopCountPolling(): void {
  window.clearInterval(countTimer);
  countTimer = undefined;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot(): Promise<void> {
  if (!hasWallet()) {
    goto("no-wallet");
    return;
  }
  if (!CONTRACT_ADDRESS) {
    goto("not-deployed");
    return;
  }

  // Reconnect silently if the wallet already trusts this site, so a reload lands
  // straight back on the right screen without a popup.
  await refresh();

  startCountPolling();

  onWalletChange(() => {
    state = {stage: state.stage};
    void refresh();
  });

  // Catch up immediately when the student comes back to the tab.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.account) void refreshCount();
  });
}

console.info(
  `CPSC3640NFT claim page | network=${NETWORK.label} chain=${CHAIN_ID} ` +
    `contract=${CONTRACT_ADDRESS ?? "none"} deploymentBlock=${DEPLOYMENT.deploymentBlock}`
);

render();
void boot();
