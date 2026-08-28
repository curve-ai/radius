import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export const cx = cn;

export function absoluteUrl(path: string) {
  return `${process.env.NEXT_PUBLIC_SERVICE_URL}/${path}`;
}

export function generateShortToken(length: number) {
  // Create an array of characters to use.
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  // Generate a random string of the specified length.
  let token = "";
  for (let i = 0; i < length; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }

  // Return the token.
  return token;
}

export const getStringLabel = (name?: string) => {
  if (!name) return "";
  // remove all non-alphanumeric characters
  return name
    .replaceAll(/[^a-zA-Z0-9\s]/g, "")
    .substring(0, 2)
    .toUpperCase();
};

export function formatPhoneNumber(phoneNumberString: string) {
  const cleaned = ("" + phoneNumberString).replace(/\D/g, "");
  const match = cleaned.match(/^(1|)?(\d{3})(\d{3})(\d{4})$/);
  if (match) {
    const intlCode = match[1] ? "+1 " : "";
    return [intlCode, "(", match[2], ") ", match[3], "-", match[4]].join("");
  }
  return null;
}

export const isUserAdmin = (userId: string) => {
  return userId === "user_2hCeOdfBD5HGamEJR0ntqj7wu55";
};

export const formatCurrency = (value: number) => {
  return Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  }).format(value);
};

// Transaction Code List
// Value	Meaning
// A	Grant, award or other acquisition pursuant to Rule 16b-3(d)
// C	Conversion of derivative security
// D	Disposition to the issuer of issuer equity securities pursuant to Rule 16b-3(e)
// E	Expiration of short derivative position
// F	Payment of exercise price or tax liability by delivering or withholding securities incident to the receipt, exercise or vesting of a security issued in accordance with Rule 16b-3
// G	Bona fide gift
// H	Expiration (or cancellation) of long derivative position with value received
// I	Discretionary transaction in accordance with Rule 16b-3(f) resulting in acquisition or disposition of issuer securities
// J	Other acquisition or disposition (describe transaction)
// L	Small acquisition under Rule 16a-6
// M	Exercise or conversion of derivative security exempted pursuant to Rule 16b-3
// O	Exercise of out-of-the-money derivative security
// P	Open market or private purchase of non-derivative or derivative security
// S	Open market or private sale of non-derivative or derivative security
// U	Disposition pursuant to a tender of shares in a change of control transaction
// W	Acquisition or disposition by will or the laws of descent and distribution
// X	Exercise of in-the-money or at-the-money derivative security
// Z	Deposit into or withdrawal from voting trust

export const transactionCodeMeaning = {
  A: {
    veryShort: "Received",
    short: "Grant, award or other acquisition pursuant to Rule 16b-3(d)",
    long: "Receiving shares or options as part of a company-approved compensation plan.",
  },
  C: {
    veryShort: "Conversion",
    short: "Conversion of derivative security",
    long: "Exchanging one type of financial instrument (like options) for actual company shares.",
  },
  D: {
    veryShort: "Tax Withholding",
    short:
      "Disposition to the issuer of issuer equity securities pursuant to Rule 16b-3(e)",
    long: "Returning shares to the company, often to pay taxes or exercise costs.",
  },
  E: {
    veryShort: "Expired",
    short: "Expiration of short derivative position",
    long: "When a bet against the company's stock price expires worthless.",
  },
  F: {
    veryShort: "Tax Payment",
    short:
      "Payment of exercise price or tax liability by delivering or withholding securities",
    long: "Using some shares to cover the costs or taxes of acquiring more shares.",
  },
  G: {
    veryShort: "Charity",
    short: "Bona fide gift",
    long: "Giving away shares as a genuine gift, not a sale.",
  },
  H: {
    veryShort: "Realized Derivative",
    short:
      "Expiration (or cancellation) of long derivative position with value received",
    long: "When a bet on the company's stock price pays off at expiration.",
  },
  I: {
    veryShort: "Discretionary",
    short: "Discretionary transaction in accordance with Rule 16b-3(f)",
    long: "A transaction within a company-approved plan, like selling shares in a 401(k).",
  },
  J: {
    veryShort: "Other",
    short: "Other acquisition or disposition (describe transaction)",
    long: "Any other type of transaction not covered by other codes.",
  },
  L: {
    veryShort: "Small Acquisition",
    short: "Small acquisition under Rule 16a-6",
    long: "Buying a small number of shares (less than $10,000 and 0.001% of outstanding shares).",
  },
  M: {
    veryShort: "Conversion",
    short:
      "Exercise or conversion of derivative security exempted pursuant to Rule 16b-3",
    long: "Converting options or similar instruments into actual shares under a company plan.",
  },
  O: {
    veryShort: "Exercise",
    short: "Exercise of out-of-the-money derivative security",
    long: "Using the right to buy shares at a price higher than the current market value.",
  },
  P: {
    veryShort: "Purchase",
    short:
      "Open market or private purchase of non-derivative or derivative security",
    long: "Buying shares or options on the open market or in a private deal.",
  },
  S: {
    veryShort: "Sale",
    short:
      "Open market or private sale of non-derivative or derivative security",
    long: "Selling shares or options on the open market or in a private deal.",
  },
  U: {
    veryShort: "Sale",
    short:
      "Disposition pursuant to a tender of shares in a change of control transaction",
    long: "Selling shares as part of a company takeover or merger.",
  },
  W: {
    veryShort: "Inheritance",
    short:
      "Acquisition or disposition by will or the laws of descent and distribution",
    long: "Receiving or transferring shares due to inheritance.",
  },
  X: {
    veryShort: "Exercise",
    short: "Exercise of in-the-money or at-the-money derivative security",
    long: "Using the right to buy shares at or below the current market price.",
  },
  Z: {
    veryShort: "Transfer",
    short: "Deposit into or withdrawal from voting trust",
    long: "Moving shares in or out of a special trust that controls voting rights.",
  },
};

// const codeList = ["A", "C", "D", "E", "F", "G", "H", "I", "J", "L", "M", "O", "P", "S", "U", "W", "X", "Z"];
// Tremor Raw focusInput [v0.0.1]

export const focusInput = [
  // base
  "focus:ring-2",
  // ring color
  "focus:ring-blue-200 focus:dark:ring-blue-700/30",
  // border color
  "focus:border-blue-500 focus:dark:border-blue-700",
];

// Tremor Raw focusRing [v0.0.1]

export const focusRing = [
  // base
  "outline outline-offset-2 outline-0 focus-visible:outline-2",
  // outline color
  "outline-blue-500 dark:outline-blue-500",
];

// Tremor Raw hasErrorInput [v0.0.1]

export const hasErrorInput = [
  // base
  "ring-2",
  // border color
  "border-red-500 dark:border-red-700",
  // ring color
  "ring-red-200 dark:ring-red-700/30",
];
