/**
 * The claim page.
 *
 * One screen, four stages: connect, check eligibility, claim, confirmed. Every stage
 * is a value of `State.stage`, and `render` is a pure function of that state, so what
 * you see always matches what the page believes.
 *
 * Two rules shape the whole file:
 *   1. Eligibility is confirmed against the contract, never from proofs.json alone.
 *   2. The user is never shown a stack trace. Details go to the console.
 */
import type {Address, Hex} from "viem";

import "./style.css";
// The exact bytes the contract stores, so the preview cannot disagree with the token.
import courseArtwork from "../../nft/course-nft-onchain.webp";

import {
  CHAIN_ID,
  CONTRACT_ADDRESS,
  COURSE,
  DEPLOYMENT,
  NETWORK,
  explorerAddress,
  explorerTx
} from "./config";
import {proofFor, publishedRoot} from "./allowlist";
import {explain, type FriendlyError} from "./errors";
import {
  findClaimedTokenId,
  isEligibleOnChain,
  readContractState,
  readToken,
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
  /** True once a submitted transaction has been outstanding long enough to mention. */
  slow?: boolean;
  /** A recoverable problem, shown as a banner without discarding the current stage. */
  notice?: FriendlyError;
}

const root = document.querySelector<HTMLElement>("#app")!;
let state: State = {stage: "disconnected"};
let pendingTimer: number | undefined;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]!
  );
}

function shorten(value: string, lead = 6, tail = 4): string {
  return value.length <= lead + tail + 2 ? value : `${value.slice(0, lead)}...${value.slice(-tail)}`;
}

function setState(patch: Partial<State>): void {
  state = {...state, ...patch};
  render();
}

/** Move to a stage and drop anything left over from the previous one. */
function goto(stage: Stage, patch: Partial<State> = {}): void {
  window.clearTimeout(pendingTimer);
  state = {stage, account: state.account, ...patch};
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const STEP_OF: Record<Stage, number> = {
  "no-wallet": 0,
  "not-deployed": 0,
  disconnected: 0,
  connecting: 0,
  "wrong-network": 1,
  checking: 1,
  "not-eligible": 1,
  "claim-closed": 1,
  eligible: 2,
  "awaiting-signature": 2,
  pending: 2,
  claimed: 3
};

const STEP_LABELS = ["Connect Wallet", "Check Eligibility", "Claim NFT", "Confirmed"];

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
      return `<h2>A wallet is required</h2>
        <p class="lede">This page talks to Ethereum directly from your browser.</p>
        ${statusBlock(
          "warn",
          "No Ethereum wallet detected",
          "Install MetaMask or another injected wallet, then reload this page."
        )}
        <div class="links"><a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">Get MetaMask</a></div>`;

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

    case "eligible":
      return `<h2>You are eligible</h2>
        ${walletRow()}
        ${noticeBlock()}
        ${statusBlock("good", "Eligible to claim", "One NFT per wallet. Your wallet will ask you to approve the transaction.")}
        <button class="primary" id="claim">Claim Course NFT</button>`;

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
      const txLink = state.txHash ? explorerTx(state.txHash) : null;
      const contractLink = CONTRACT_ADDRESS ? explorerAddress(CONTRACT_ADDRESS) : null;
      return `<h2>NFT claimed!</h2>
        <p class="lede">${escapeHtml(COURSE.code)} &mdash; ${escapeHtml(COURSE.term)}</p>
        ${noticeBlock()}
        ${statusBlock("good", "This wallet owns the course NFT", "Metadata and artwork are stored entirely on-chain.")}
        <dl class="rows">
          <div><dt>Token</dt><dd class="mono">#${state.token?.tokenId ?? "?"}</dd></div>
          <div><dt>Owner</dt><dd class="mono">${shorten(state.account ?? "")}</dd></div>
        </dl>
        <div class="links">
          ${txLink ? `<a href="${txLink}" target="_blank" rel="noopener noreferrer">View transaction</a>` : ""}
          ${contractLink ? `<a href="${contractLink}" target="_blank" rel="noopener noreferrer">View contract</a>` : ""}
        </div>`;
    }
  }
}

/** Left column: the local preview before claiming, the real tokenURI image after. */
function artwork(): string {
  if (state.stage === "claimed" && state.token) {
    return `<figure class="card art">
      <img src="${state.token.image}" alt="${escapeHtml(state.token.name)}" />
      <figcaption>Rendered from <code>tokenURI(${state.token.tokenId})</code> on-chain</figcaption>
    </figure>`;
  }
  return `<figure class="card art">
    <img src="${courseArtwork}" alt="CPSC 3640/5400 course NFT artwork" />
    <figcaption>Preview &mdash; the same artwork the contract stores</figcaption>
  </figure>`;
}

function chainbar(): string {
  const address = CONTRACT_ADDRESS
    ? `<span class="mono">${shorten(CONTRACT_ADDRESS, 10, 8)}</span>`
    : "<span>not deployed</span>";
  const link = CONTRACT_ADDRESS ? explorerAddress(CONTRACT_ADDRESS) : null;
  return `<div class="chainbar">
    <div>Network <span>${escapeHtml(NETWORK.label)}</span> (chain ${CHAIN_ID})</div>
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
    <p class="disclaimer">A course collectible, not an official academic credential.</p>
  `;

  bind("connect", connect);
  bind("switch", switchNetwork);
  bind("claim", claim);
  bind("cancel", () => refresh());
}

function bind(id: string, handler: () => void): void {
  document.getElementById(id)?.addEventListener("click", handler);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

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

    const [contractState, proof] = await Promise.all([
      readContractState(account),
      proofFor(account)
    ]);

    // Already claimed in this or an earlier session: rebuild the success view from chain state.
    if (contractState.hasClaimed) {
      await showOwnedToken(account);
      return;
    }

    if (!contractState.claimOpen) {
      goto("claim-closed", {account});
      return;
    }

    if (!proof) {
      goto("not-eligible", {account});
      return;
    }

    // proofs.json says yes. Only the contract's answer decides whether we offer a button.
    const eligible = await isEligibleOnChain(account, proof);
    if (!eligible) {
      const root = await publishedRoot().catch(() => null);
      const stale = root && root.toLowerCase() !== contractState.merkleRoot.toLowerCase();
      goto("not-eligible", {
        account,
        notice: stale
          ? {
              message: "This page is showing an out-of-date allowlist.",
              detail: "The published Merkle root does not match the contract. Ask the course staff to rebuild the site."
            }
          : undefined
      });
      return;
    }

    goto("eligible", {account, proof});
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
    const token = await readToken(found.tokenId);
    goto("claimed", {account, token, txHash: txHash ?? found.transactionHash});
  } catch (error) {
    goto("claimed", {
      account,
      txHash,
      notice: explain(error, "You own the NFT, but its artwork could not be loaded right now.")
    });
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
    goto("eligible", {account, proof, notice: explain(error, "The claim could not be submitted.")});
    return;
  }

  goto("pending", {account, proof, txHash: hash});
  // "Transaction remains pending" is a state the page has to be honest about.
  pendingTimer = window.setTimeout(() => {
    if (state.stage === "pending") setState({slow: true});
  }, 45_000);

  try {
    const tokenId = await waitForClaim(hash);
    const token = await readToken(tokenId);
    goto("claimed", {account, token, txHash: hash});
  } catch (error) {
    goto("eligible", {
      account,
      proof,
      notice: explain(error, "The transaction did not complete successfully.")
    });
  }
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

  onWalletChange(() => {
    state = {stage: state.stage};
    void refresh();
  });
}

console.info(
  `CPSC3640NFT claim page | network=${NETWORK.label} chain=${CHAIN_ID} ` +
    `contract=${CONTRACT_ADDRESS ?? "none"} deploymentBlock=${DEPLOYMENT.deploymentBlock}`
);

render();
void boot();
