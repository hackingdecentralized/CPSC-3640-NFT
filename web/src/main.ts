/**
 * The claim page.
 *
 * One screen, four stages: connect, check eligibility, claim, confirmed. Every stage
 * is a value of `State.stage`, and `render` is a pure function of that state, so what
 * you see always matches what the page believes.
 *
 * Each token gets its own generated card. Before claiming, the page shows the six
 * designs a card can have. After claiming, it draws the student's card from their
 * token id and address (see card.ts), which is the card the token later reveals.
 *
 * Two rules shape the whole file:
 *   1. Eligibility is confirmed against the contract, never from proofs.json alone.
 *   2. The user is never shown a stack trace. Details go to the console.
 */
import type {Address, Hex} from "viem";

import "./style.css";
// The exact bytes the contract stores, so the preview cannot disagree with the token.
import courseArtwork from "../../nft/course-nft-onchain.webp";

import {FINGERPRINT, designs, drawCard, loadAssets, type Card, type Design} from "./card";
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
  readRevealedCount,
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
  /** Tokens minted so far. Token ids are claim order, so this is the queue length. */
  totalMinted?: bigint;
  /** False when the contract lets anyone claim, so the panel can say so. */
  allowlistEnabled?: boolean;
  /** True once a submitted transaction has been outstanding long enough to mention. */
  slow?: boolean;
  /** A recoverable problem, shown as a banner without discarding the current stage. */
  notice?: FriendlyError;
  /** Whether this deployment gives each token a generated card. Unknown until first read. */
  revealable?: boolean;
  /** Tokens 1..revealedCount already show their card in wallets. */
  revealedCount?: bigint;
  /** Example cards for the six designs. `null` if the artwork could not be loaded. */
  designs?: Design[] | null;
  /** The claimed token's card. */
  card?: CardView;
}

type CardView =
  | {status: "drawing"; tokenId: bigint}
  | {status: "ready"; card: Card}
  | {status: "failed"; tokenId: bigint; error: FriendlyError};

/**
 * Enough native currency to be confident the claim will go through. A claim costs
 * roughly 150k gas; this is a generous floor, not a precise estimate.
 */
const COMFORTABLE_GAS_WEI = 1_000_000_000_000_000n; // 0.001 ETH

const root = document.querySelector<HTMLElement>("#app")!;
let state: State = {stage: "disconnected"};
let pendingTimer: number | undefined;
let countTimer: number | undefined;

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
  const {account, totalMinted, revealable, revealedCount} = state;
  state = {stage, account, totalMinted, revealable, revealedCount, designs: state.designs, ...patch};
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
      const art = state.revealable
        ? "Your card is drawn from your wallet address and your claim number."
        : "Your claim number is minted into the artwork itself.";
      return `<h2>You are eligible</h2>
        ${walletRow()}
        ${noticeBlock()}
        ${statusBlock("good", `You will be the ${ordinal(next)} to claim`, `${who} ${art}`)}
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
      const revealed = hasCard(token) && tokenId !== undefined && tokenId <= (state.revealedCount ?? 0n);
      const txLink = state.txHash ? explorerTx(state.txHash) : null;
      const contractLink = CONTRACT_ADDRESS ? explorerAddress(CONTRACT_ADDRESS) : null;
      return `<h2>NFT claimed!</h2>
        <p class="lede">${escapeHtml(COURSE.code)} &mdash; ${escapeHtml(COURSE.term)}</p>
        ${noticeBlock()}
        ${statusBlock(
          stillHeld ? "good" : "info",
          tokenId === undefined
            ? "This wallet owns the course NFT"
            : `You were the ${ordinal(tokenId)} to claim`,
          !stillHeld
            ? "This token has since been transferred to another address. The claim record is permanent either way."
            : !hasCard(token)
              ? "Metadata and artwork are stored entirely on-chain, your claim number included."
              : revealed
                ? "Wallets and marketplaces now show this card."
                : "For now your wallet shows the course placeholder. It switches to this card when the course staff publish the collection."
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
          <div><dt>Owner</dt><dd class="mono">${shorten(holder ?? state.account ?? "")}</dd></div>
        </dl>
        ${card ? traitList(card) : ""}
        <div class="links">
          ${card ? `<a href="${card.image}" download="${escapeHtml(card.fileName)}">Download image</a>` : ""}
          ${txLink ? `<a href="${txLink}" target="_blank" rel="noopener noreferrer">View transaction</a>` : ""}
          ${contractLink ? `<a href="${contractLink}" target="_blank" rel="noopener noreferrer">View contract</a>` : ""}
        </div>`;
    }
  }
}

/** Whether this token has a generated card: a reveal-capable contract recorded its claimer. */
function hasCard(token: OwnedToken | undefined): token is OwnedToken & {claimer: Address} {
  return Boolean(state.revealable && token?.claimer);
}

function readyCard(): Card | undefined {
  const view = state.card;
  return view?.status === "ready" && view.card.tokenId === state.token?.tokenId ? view.card : undefined;
}

/** The card's traits, under the names its metadata uses. Rare values stand out. */
function traitList(card: Card): string {
  const items = card.traits
    .map(
      ({label, value, odds}) => `<div${odds !== undefined && odds <= 5 ? ' class="rare"' : ""}>
        <dt>${escapeHtml(label)}</dt>
        <dd>${escapeHtml(value)}${odds === undefined ? "" : ` <span>${odds}%</span>`}</dd>
      </div>`
    )
    .join("");
  return `<dl class="traits" aria-label="Card traits">${items}</dl>`;
}

/**
 * Left column. Before claiming: the six designs a card can have. After: the student's
 * own card. A contract without generated cards shows its one on-chain artwork instead.
 */
function artwork(): string {
  const token = state.stage === "claimed" ? state.token : undefined;
  if (token && hasCard(token)) return cardFigure(token.tokenId);
  if (token?.placeholder) {
    return `<figure class="card art">
      <img src="${token.placeholder.image}" alt="${escapeHtml(token.placeholder.name)}" />
      <figcaption>Rendered from <code>tokenURI(${token.tokenId})</code> on-chain</figcaption>
    </figure>`;
  }
  if (state.revealable === false || state.designs === null) {
    return `<figure class="card art">
      <img src="${courseArtwork}" alt="CPSC 3640/5400 course NFT artwork" />
      <figcaption>Preview &mdash; the same artwork the contract stores</figcaption>
    </figure>`;
  }
  return designsFigure();
}

function designsFigure(): string {
  const tiles = state.designs
    ? state.designs
        .map(
          ({label, odds, sample}) => `<figure>
            <img src="${sample}" alt="Example ${escapeHtml(label)} card" width="480" height="480" />
            <figcaption>${escapeHtml(label)} <span>${odds}%</span></figcaption>
          </figure>`
        )
        .join("")
    : '<figure aria-hidden="true"><div class="tile"></div><figcaption>&nbsp;<span>&nbsp;</span></figcaption></figure>'.repeat(6);
  return `<figure class="card art">
    <div class="designs">${tiles}</div>
  </figure>`;
}

function cardFigure(tokenId: bigint): string {
  const card = readyCard();
  if (card) {
    return `<figure class="card art">
      <img src="${card.image}" alt="${escapeHtml(card.name)}" width="1024" height="1024" />
      <figcaption>Your card, drawn from token #${tokenId} and the wallet that claimed it</figcaption>
    </figure>`;
  }
  const view = state.card;
  const body =
    view?.status === "failed"
      ? `${statusBlock("bad", view.error.message, undefined, {detail: view.error.detail})}
         <button class="secondary" id="redraw">Try again</button>`
      : statusBlock("info", "Drawing your card...", undefined, {spinner: true});
  return `<figure class="card art"><div class="pending-card stack">${body}</div></figure>`;
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
  // Lets the course staff confirm the reveal reproduces the cards this page draws.
  const collection =
    state.revealable === false ? "" : `<div>Collection <span class="mono">${FINGERPRINT}</span></div>`;

  return `<div class="chainbar">
    <div>Network <span>${escapeHtml(NETWORK.label)}</span> (chain ${CHAIN_ID})</div>
    ${claimed}
    ${collection}
    <div>Contract ${link ? `<a class="mono" href="${link}" target="_blank" rel="noopener noreferrer">${shorten(CONTRACT_ADDRESS!, 10, 8)}</a>` : address}</div>
  </div>`;
}

function render(): void {
  root.innerHTML = `
    <header class="masthead">
      <h1>${escapeHtml(COURSE.code)}</h1>
      <p>${escapeHtml(COURSE.title)}</p>
      <div class="term">${escapeHtml(COURSE.term)}</div>
    </header>
    ${stepper(STEP_OF[state.stage])}
    <div class="grid">
      ${artwork()}
      <section class="card stack">${panel()}</section>
    </div>
    ${chainbar()}
    <p class="disclaimer">
      &copy; Yale ${escapeHtml(COURSE.code)},
      <a href="${COURSE.site}" target="_blank" rel="noopener noreferrer">${escapeHtml(COURSE.site)}</a>
    </p>
  `;

  bind("reload", () => window.location.reload());
  bind("copy", copyAddress);
  bind("recheck", () => void refresh());
  bind("connect", connect);
  bind("switch", switchNetwork);
  bind("claim", claim);
  bind("cancel", () => refresh());
  bind("redraw", () => void showCard());
}

function bind(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener("click", handler);
}

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
  const account = state.account ?? (await connectedAccount());
  if (!account) {
    goto("disconnected");
    return;
  }

  goto("checking", {account});

  try {
    const chainId = await currentChainId();
    if (chainId !== CHAIN_ID) {
      goto("wrong-network", {account, wrongChainId: chainId});
      return;
    }

    const [contractState, balance] = await Promise.all([
      readContractState(account),
      balanceOf(account)
    ]);
    const {allowlistEnabled, totalMinted, revealable, revealedCount} = contractState;
    // Facts about the contract, kept across stages by `goto`.
    state = {...state, totalMinted, revealable, revealedCount};

    // Already claimed in this or an earlier session: rebuild the success view from chain state.
    if (contractState.hasClaimed) {
      await showOwnedToken(account);
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
      if (!found) {
        goto("not-eligible", {account, allowlistEnabled});
        return;
      }

      // proofs.json says yes. Only the contract's answer decides whether we offer a button.
      if (!(await isEligibleOnChain(account, found))) {
        const root = await publishedRoot().catch(() => null);
        const stale = root && root.toLowerCase() !== contractState.merkleRoot.toLowerCase();
        goto("not-eligible", {
          account,
          allowlistEnabled,
          notice: stale
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
    goto("disconnected", {
      account,
      notice: explain(error, "Could not reach the network. Check your connection and try again.")
    });
  }
}

async function showOwnedToken(account: Address, txHash?: Hex): Promise<void> {
  try {
    const found = await findClaimedTokenId(account);
    if (!found) {
      goto("claimed", {account, txHash});
      return;
    }
    const token = await readToken(found.tokenId, state.revealable ?? false);
    showClaimed({account, token, txHash: txHash ?? found.transactionHash});
  } catch (error) {
    goto("claimed", {
      account,
      txHash,
      notice: explain(error, "You own the NFT, but its artwork could not be loaded right now.")
    });
  }
}

/** Finished cards, so returning to the claimed view never shows the spinner twice. */
const cards = new Map<string, Card>();
const cardKey = (tokenId: bigint, claimer: Address) => `${tokenId}:${claimer.toLowerCase()}`;

function showClaimed(patch: Partial<State>): void {
  const token = patch.token;
  const ready = token?.claimer ? cards.get(cardKey(token.tokenId, token.claimer)) : undefined;
  goto("claimed", ready ? {...patch, card: {status: "ready", card: ready}} : patch);
  if (!ready) void showCard();
}

/** Draw the claimed token's card, if it has one, and show it when done. */
async function showCard(): Promise<void> {
  const token = state.token;
  if (state.stage !== "claimed" || !hasCard(token)) return;
  const {tokenId, claimer} = token;
  const current = () => state.stage === "claimed" && state.token?.tokenId === tokenId;

  setState({card: {status: "drawing", tokenId}});
  try {
    const card = await drawCard(tokenId, claimer);
    cards.set(cardKey(tokenId, claimer), card);
    if (current()) setState({card: {status: "ready", card}});
  } catch (error) {
    if (current()) {
      setState({card: {status: "failed", tokenId, error: explain(error, "Your card could not be drawn right now.")}});
    }
  }
}

async function claim(): Promise<void> {
  const {account, proof} = state;
  if (!account || !proof) return;

  goto("awaiting-signature", {account, proof});

  let hash: Hex;
  try {
    hash = await submitClaim(account, proof, walletClient(account));
  } catch (error) {
    goto("eligible", {
      account,
      proof,
      totalMinted: state.totalMinted,
      notice: explain(error, "The claim could not be submitted.")
    });
    return;
  }

  goto("pending", {account, proof, txHash: hash});
  // "Transaction remains pending" is a state the page has to be honest about.
  pendingTimer = window.setTimeout(() => {
    if (state.stage === "pending") setState({slow: true});
  }, 45_000);

  try {
    const tokenId = await waitForClaim(hash);
    const token = await readToken(tokenId, state.revealable ?? false);
    // This claim is the newest, so the count is at least this token's number.
    if (state.totalMinted === undefined || state.totalMinted < tokenId) state = {...state, totalMinted: tokenId};
    showClaimed({account, token, txHash: hash});
  } catch (error) {
    goto("eligible", {
      account,
      proof,
      totalMinted: state.totalMinted,
      notice: explain(error, "The transaction did not complete successfully.")
    });
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
      // A student who stays on the page sees their card go live when it is published.
      if (state.stage === "claimed" && state.revealable) {
        const revealed = await readRevealedCount();
        if (revealed !== state.revealedCount) setState({revealedCount: revealed});
      }
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
  // The example cards need no wallet, so they load first, for everyone.
  loadAssets()
    .then((index) => setState({designs: designs(index)}))
    .catch((error: unknown) => {
      console.error("card artwork unavailable; showing the on-chain artwork instead", error);
      setState({designs: null});
    });

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
    state = {stage: state.stage, designs: state.designs};
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
