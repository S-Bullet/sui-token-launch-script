import assert from 'assert';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { CoinBalance, SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

import { TestnetSDK as cetusClmmSDK } from './init_testnet_sdk'
import * as config from '../config';
import { getWalletFromPrivateKey } from './wallet';
import { buildSuiContract } from '../api';
import * as dotenv from "dotenv"
import { Sticker } from 'node-telegram-bot-api';
import { send } from 'process';

dotenv.config();

const suiClient = new SuiClient({
    url: getFullnodeUrl("testnet"),
});

export const sleep = (ms: number) => {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export const getSUIBalance = async (owner: string): Promise<CoinBalance | undefined> => {
    assert(suiClient)

    console.log(`getting wallet balance... owner: ${owner}`);

    try {
        const coinType = config.SUI_COIN_TYPE;
        let balance: CoinBalance = await suiClient.getBalance({ owner, coinType });
        console.log(`balance: ${balance.totalBalance}`);
        return balance;
    } catch (error) {
        console.log(error);
        return undefined;
    }
}

export const transferSUI = async (txb: Transaction | null, pkey: string, destPubkey: string, amount: number, excute?: boolean) => {

    console.log('Transfering SUI...');
    const walletInfo: any | null = getWalletFromPrivateKey(pkey)
    if (!walletInfo) {
        console.log(`❗ Transfer failed: Invalid wallet.`)
        return undefined;
    };

    if(!txb)
        txb = new Transaction();

    const [splitedInputCoins] = txb.splitCoins(txb.gas, [
        amount.toString(),
    ]);

    console.log(`gas: ${JSON.stringify(txb.gas)}`);
    console.log(`splitedInputCoins: ${JSON.stringify(splitedInputCoins)}`);
    console.log(`txb: ${JSON.stringify(txb)}`);

    txb.transferObjects([splitedInputCoins], destPubkey);

    if (excute) {
        cetusClmmSDK.fullClient.sendTransaction(walletInfo.wallet, txb);
        return;
    }
    return { txb };
}

export const disperseSUI = async (depositWallet: any, destPubkeys: string[], amounts: number[]) => {
    const tx = new Transaction();

    // first, split the gas coin into multiple coins
    const coins = tx.splitCoins(
        tx.gas,
        amounts,
    );

    // next, create a transfer transaction for each coin
    for (let i = 0; i < destPubkeys.length; i++) {
        tx.transferObjects([coins[i]], destPubkeys[i]);
    }
    const transferTxn = await cetusClmmSDK.fullClient.sendTransaction(depositWallet.wallet, tx);

    if (!transferTxn) {
        console.error(`Error while sending transfer transaction`);
        return false;
    }

    console.log(`Dispersed SUI to buy wallets. Waiting 3s for confirm...`);
    await sleep(3000);
    return true;
}

export const refundSUI = async (depositWallet: any, wallets: any[]) => {
    for (let i = 0; i < wallets.length; i++) {
        const walletBalance = await getSUIBalance(wallets[i].publicKey);
        if (!walletBalance) continue;

        let coinObjectIds: string[] = [];
        const tx = new Transaction();
        const senderCoin = await cetusClmmSDK.fullClient.getCoins({ owner: wallets[i].publicKey, coinType: config.SUI_COIN_TYPE });
        for (let j = 0; j < senderCoin.data.length; j++) {
            coinObjectIds.push(senderCoin.data[j].coinObjectId)
        }
        console.log(`coinObjectIds: ${coinObjectIds}`);
        for (let i = 0; i < coinObjectIds.length; i++) {
            tx.transferObjects([coinObjectIds[i]], depositWallet.publicKey);
        }
        tx.setSender(wallets[i].publicKey);
        tx.setGasOwner(depositWallet.publicKey);

        const kindBytes = await tx.build({ client: cetusClmmSDK.fullClient });
        const sponsorSig = await depositWallet.wallet.signTransaction(kindBytes);
        const senderSig = await wallets[i].wallet.signTransaction(kindBytes);
        console.log(`tx: ${await tx.toJSON()}`);

        try {
            const result = await cetusClmmSDK.fullClient.executeTransactionBlock({
                transactionBlock: kindBytes,
                signature: [senderSig.signature, sponsorSig.signature],
                options: {
                    showEffects: false,
                    showBalanceChanges: true,
                    showEvents: false,
                    showInput: false,
                    showObjectChanges: false,
                },
            });
            console.log(result);
            sleep(2000);
        } catch (error) {
            console.log(`error: ${error}`)
        }

    }
    return true;
}

export const createToken = async (
    keypair: Ed25519Keypair,
    name: string, 
    symbol: string, 
    decimal: number,
    description: string,
    supply: number,
    icon_url: string
): Promise<string> => {
    try {
        const { modules, dependencies, module_name } = await buildSuiContract( name, symbol, decimal.toString(), description, (supply*Math.pow(10, decimal)).toString(), icon_url );

        // Create a new transaction to publish the Move package
        const tx = new Transaction();
        const [upgradeCap] = tx.publish({
            modules,
            dependencies
        });
        
        tx.transferObjects([upgradeCap], keypair.toSuiAddress());
        const response = await suiClient.signAndExecuteTransaction({
            signer: keypair,
            transaction: tx,
        });

        const result = await suiClient.waitForTransaction({
            digest: response.digest,
            options: {
                showEffects: true,
            }
        })
        // console.log('Transaction Result:', result);
        
        //@ts-ignore
        const packageID =  result.effects.created[0].reference.objectId;
        // console.log('Published Package ID:', packageID);

        return `${packageID}::${module_name}::${module_name.toUpperCase()}`;
    } catch (error) {
        console.error('Error publishing Move package:');
        
        return '';
    }

}

export const getTokenBalance = async (owner: string, coinType: string): Promise<CoinBalance | undefined> => {
    assert(suiClient)

    console.log(`getting wallet balance... owner: ${owner}`);

    try {
        let balance: CoinBalance = await suiClient.getBalance({ owner, coinType });
        console.log(`balance: ${balance}`);
        return balance;
    } catch (error) {
        console.log(error);
        return undefined;
    }

}

export const transferToken = async (pkey: string, coinType: string, destPubkey: string, amount: number, excute?: boolean) => {

    console.log('Transfering Token...');
    const walletInfo: any | null = getWalletFromPrivateKey(pkey)
    if (!walletInfo) {
        console.log(`❗ Transfer failed: Invalid wallet.`)
        return undefined;
    };

    const walletBalance = await getTokenBalance(walletInfo.publicKey, coinType);
    console.log("walletBalance =>", walletBalance)

    const tx = new Transaction();
    const senderCoin = await suiClient.getCoins({ owner: walletInfo.publicKey, coinType });
    console.log("coin cout: ", senderCoin.data.length);

    let coinObjectIds: string[] = [];
    if (senderCoin.data.length > 1) {
        for (let j = 1; j < senderCoin.data.length; j++) {
            coinObjectIds.push(senderCoin.data[j].coinObjectId)
        }
        tx.mergeCoins(senderCoin.data[0].coinObjectId, coinObjectIds);
    }
    const splitedInputCoins = tx.splitCoins(senderCoin.data[0].coinObjectId, [
        amount,
    ]);
    

    tx.transferObjects([splitedInputCoins[0]], destPubkey);
    // tx.setGasBudget(10000000);
    
    if (excute) {
        const tr = await suiClient.signAndExecuteTransaction({signer: walletInfo.wallet, transaction: tx});
        console.log(tr);
        const re = await suiClient.waitForTransaction({digest:tr.digest, options: {showEffects: true}});
        console.log(re);
        return;
    }
    return { tx };
}

export const disperseToken = async (depositWallet: any, coinType: string, destPubkeys: any[], amounts: number[]) => {    
    const walletBalance = await getTokenBalance(depositWallet.publicKey, coinType);
    console.log("walletBalance =>", walletBalance)

    let totalAmount = 0;
    for (let j = 1; j < amounts.length; j++) {
        totalAmount += amounts[j]
    }

    // @ts-ignore
    if (walletBalance.totalBalance < totalAmount) {
        return false;
    }

    const tx = new Transaction();

    const senderCoin = await suiClient.getCoins({ owner: depositWallet.publicKey, coinType });
    console.log("coin cout: ", senderCoin.data.length);

    let coinObjectIds: string[] = [];
    if (senderCoin.data.length > 1) {
        for (let j = 1; j < senderCoin.data.length; j++) {
            coinObjectIds.push(senderCoin.data[j].coinObjectId)
        }
        tx.mergeCoins(senderCoin.data[0].coinObjectId, coinObjectIds);
    }

    // first, split the gas coin into multiple coins
    const coins = tx.splitCoins(
        senderCoin.data[0].coinObjectId,
        amounts,
    );

    // next, create a transfer transaction for each coin
    for (let i = 0; i < destPubkeys.length; i++) {
        tx.transferObjects([coins[i]], destPubkeys[i]);
    }

    const transferTxn = await cetusClmmSDK.fullClient.sendTransaction(depositWallet.wallet, tx);

    if (!transferTxn) {
        console.error(`Error while sending transfer transaction`);
        return false;
    }

    console.log(`Dispersed SUI to buy wallets. Waiting 3s for confirm...`);
    await sleep(3000);
    return true;
}

export const refundToken = async (depositWallet: any, wallets: any[], coinType: string) => {
    for (let i = 0; i < wallets.length; i++) {
        const walletBalance = await getSUIBalance(wallets[i].publicKey);
        if (!walletBalance) continue;

        let coinObjectIds: string[] = [];
        const tx = new Transaction();
        const senderCoin = await cetusClmmSDK.fullClient.getCoins({ owner: wallets[i].publicKey, coinType });
        if (senderCoin.data.length > 1) {
            for (let j = 1; j < senderCoin.data.length; j++) {
                coinObjectIds.push(senderCoin.data[j].coinObjectId)
            }
            tx.mergeCoins(senderCoin.data[0].coinObjectId, coinObjectIds);
        }
        tx.transferObjects([coinObjectIds[0]], depositWallet.publicKey);
        tx.setSender(wallets[i].publicKey);
        tx.setGasOwner(depositWallet.publicKey);

        const kindBytes = await tx.build({ client: cetusClmmSDK.fullClient });
        const sponsorSig = await depositWallet.wallet.signTransaction(kindBytes);
        const senderSig = await wallets[i].wallet.signTransaction(kindBytes);
        console.log(`tx: ${await tx.toJSON()}`);

        try {
            const result = await suiClient.executeTransactionBlock({
                transactionBlock: kindBytes,
                signature: [senderSig.signature, sponsorSig.signature],
                options: {
                    showEffects: false,
                    showBalanceChanges: true,
                    showEvents: false,
                    showInput: false,
                    showObjectChanges: false,
                },
            });
            console.log(result);
            sleep(2000);
        } catch (error) {
            console.log(`error: ${error}`)
        }

    }
    return true;
}
