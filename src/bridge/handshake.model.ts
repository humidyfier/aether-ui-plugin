export interface DomVerificationSignature {
  uid: string;
  tagName: string;
  textContent?: string;
  attributes: Record<string, string>;
  computedStyles?: Record<string, string>;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AetherPendingWrite {
  txId: string;
  targetUid: string;
  expectedTag?: string;
  expectedProps?: Record<string, string>;
  expectedStyles?: Record<string, string>;
  expectedText?: string;
  timestamp: string;
}

export interface AetherHmrAckPayload {
  type: 'AETHER_HMR_ACK';
  txId: string;
  targetUid: string;
  verified: boolean;
  domSignature?: DomVerificationSignature;
  verificationDetails?: {
    tagMatches: boolean;
    propsMatch: boolean;
    stylesMatch: boolean;
    textMatches: boolean;
    mismatches: string[];
  };
  error?: string;
  latencyMs: number;
  timestamp: string;
}

export interface HmrHandshakeResult {
  txId: string;
  targetUid: string;
  success: boolean;
  verified: boolean;
  latencyMs: number;
  ackPayload?: AetherHmrAckPayload;
  error?: string;
}
