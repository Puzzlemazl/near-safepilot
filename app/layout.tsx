import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@near-wallet-selector/modal-ui/styles.css"; // Стили кошелька ПЕРВЫМИ
import "./main.css"; // Твои стили ВТОРЫМИ
import { WalletProvider } from "../context/WalletContext"; // Путь к кошельку

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "NEAR SafePilot",
  description: "AI Agent for Secure DeFi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning={true}>
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}