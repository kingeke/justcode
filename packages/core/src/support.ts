/**
 * Developer support / donation details in one place, so the tip link and wallet
 * addresses live in a single source of truth shared by every surface (the VS Code
 * extension settings and the landing site). Kept dependency-free like
 * {@link ./branding.ts} so it is safe to bundle into the webview and the website.
 */

/** One-off "thanks for the tool" tip via card / Apple Pay / Google Pay / PayPal. */
export const KOFI_URL = 'https://ko-fi.com/kingeke';

export interface CryptoWallet {
  name: string;
  ticker: string;
  /** Chain the address is on, so senders don't use the wrong network. */
  network: string;
  address: string;
}

export const CRYPTO_WALLETS: CryptoWallet[] = [
  {
    name: 'Bitcoin',
    ticker: 'BTC',
    network: 'Bitcoin',
    address: '1B8skEF6uo8PNGjcd624gkJf3TJt73DF8X',
  },
  {
    name: 'Tether',
    ticker: 'USDT',
    network: 'TRC20 (TRON)',
    address: 'TD9UEFBPtsLLbQYxRXFCgtBWDdogkiXMqq',
  },
];
