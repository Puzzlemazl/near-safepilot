export type TxStatus = "IDLE" | "PROCESSING" | "SUCCESS" | "ERROR";
export interface PoolOption {
  name: string;
  subName: string;
  risk: "LOW" | "HIGH"; 
  apy: string;
  desc: string;
  contract: string;
  method: string;
  min: number | string; 
  isVerified: boolean;
}

export interface PortfolioItem {
  name: string;
  amount: string;
  token: string;
  nearValue: string;
  contract: string;
}