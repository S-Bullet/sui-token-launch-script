import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

export const getWalletFromPrivateKey = (secretKey: string) => {
    const keypair = Ed25519Keypair.fromSecretKey(secretKey);
    return { publicKey: keypair.getPublicKey().toSuiAddress(), secretKey: keypair.getSecretKey(), wallet: keypair };
}
