/**
 * Talking to the browser wallet.
 *
 * Only the permissions this page actually needs are requested: the account list,
 * the current chain, a chain switch, and one transaction. No token approvals, no
 * signature requests, nothing standing.
 */
import {createWalletClient, custom, type Address, type WalletClient} from "viem";
import {CHAIN, CHAIN_ID, NETWORK} from "./config";
import {isUnrecognisedChain} from "./errors";

export interface Eip1193Provider {
  request(args: {method: string; params?: unknown[] | object}): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

/**
 * The injected provider, or `null` if the browser has no wallet.
 *
 * When several wallets are installed they share `window.ethereum` and expose a
 * `providers` array. Prefer MetaMask in that case, which is what the course assumes.
 */
export function getProvider(): Eip1193Provider | null {
  const injected = window.ethereum;
  if (!injected) return null;
  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    return injected.providers.find((p) => p.isMetaMask) ?? injected.providers[0]!;
  }
  return injected;
}

export function hasWallet(): boolean {
  return getProvider() !== null;
}

function requireProvider(): Eip1193Provider {
  const provider = getProvider();
  if (!provider) throw new Error("No injected wallet is available");
  return provider;
}

/** Accounts already shared with this site. Does NOT prompt. Used on page load. */
export async function connectedAccount(): Promise<Address | null> {
  const provider = getProvider();
  if (!provider) return null;
  const accounts = (await provider.request({method: "eth_accounts"})) as Address[];
  return accounts.length > 0 ? accounts[0]! : null;
}

/** Prompts the user to connect. Throws if they decline. */
export async function requestAccount(): Promise<Address> {
  const provider = requireProvider();
  const accounts = (await provider.request({method: "eth_requestAccounts"})) as Address[];
  if (!accounts || accounts.length === 0) {
    throw new Error("The wallet returned no accounts");
  }
  return accounts[0]!;
}

export async function currentChainId(): Promise<number> {
  const provider = requireProvider();
  const hex = (await provider.request({method: "eth_chainId"})) as string;
  return Number.parseInt(hex, 16);
}

export async function isOnTargetChain(): Promise<boolean> {
  return (await currentChainId()) === CHAIN_ID;
}

/**
 * Ask the wallet to switch to the configured chain, adding it first if the wallet
 * has never heard of it (which is normal for a local Anvil node).
 */
export async function switchToTargetChain(): Promise<void> {
  const provider = requireProvider();
  const chainIdHex = `0x${CHAIN_ID.toString(16)}`;

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{chainId: chainIdHex}]
    });
  } catch (error) {
    if (!isUnrecognisedChain(error)) throw error;

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: chainIdHex,
          chainName: NETWORK.label,
          nativeCurrency: CHAIN.nativeCurrency,
          rpcUrls: [...CHAIN.rpcUrls.default.http],
          blockExplorerUrls: NETWORK.explorer ? [NETWORK.explorer] : []
        }
      ]
    });
  }
}

export function walletClient(account: Address): WalletClient {
  return createWalletClient({account, chain: CHAIN, transport: custom(requireProvider())});
}

/** Re-run `handler` whenever the user switches account or network in their wallet. */
export function onWalletChange(handler: () => void): void {
  const provider = getProvider();
  if (!provider?.on) return;
  provider.on("accountsChanged", handler as never);
  provider.on("chainChanged", handler as never);
}
