"use client";
import React, { createContext, useContext, useState, useEffect } from "react";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import type { WalletSelector, AccountState } from "@near-wallet-selector/core";
import "@near-wallet-selector/modal-ui/styles.css";
import { setupModal } from "@near-wallet-selector/modal-ui";

// --- Убедись, что setupHereWallet УДАЛЕН из импортов ---

interface WalletContextValue {
  selector: WalletSelector | null;
  accountId: string | null;
  signIn: () => void;
  signOut: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    const initWallet = async () => {
      const selector = await setupWalletSelector({
        network: "mainnet",
        modules: [
          // ОСТАВЛЯЕМ ТОЛЬКО MY NEAR WALLET
          setupMyNearWallet(), 
        ],
      });

      setSelector(selector);

      const state = selector.store.getState();
      const accounts = state.accounts;
      if (accounts.length > 0) {
        setAccountId(accounts[0].accountId);
      }

      const subscription = selector.store.observable.subscribe((state) => {
        const accounts = state.accounts;
        if (accounts.length > 0) {
          setAccountId(accounts[0].accountId);
        } else {
          setAccountId(null);
        }
      });

      return () => subscription.unsubscribe();
    };

    initWallet();
  }, []);

  const signIn = () => {
    if (!selector) return;
    const modal = setupModal(selector, {
      contractId: "meta-pool.near", // или любой другой контракт
    });
    modal.show();
  };

  const signOut = async () => {
    if (!selector) return;
    const wallet = await selector.wallet();
    await wallet.signOut();
  };

  return (
    <WalletContext.Provider value={{ selector, accountId, signIn, signOut }}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
};