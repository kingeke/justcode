// "Support the developer" details. Fill in the two crypto addresses below — the
// Ko-fi link is already set. USDT defaults to the TRON (TRC20) network; change
// `network`/`address` if you want ERC20 or an additional chain.

export interface CryptoWallet {
  name: string;
  ticker: string;
  /** Chain the address is on, shown so senders don't use the wrong network. */
  network: string;
  address: string;
}

/** One-off "thanks for the tool" tip via card / Apple Pay / Google Pay / PayPal. */
export const kofiUrl = 'https://ko-fi.com/kingeke';

export const wallets: CryptoWallet[] = [
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

/** True while an address is still the placeholder, so the UI can hide it. */
export const isPlaceholder = (address: string): boolean =>
  address.startsWith('REPLACE_WITH_');
