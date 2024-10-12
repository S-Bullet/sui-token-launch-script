import assert from 'assert';
import { CoinBalance, SuiClient } from '@mysten/sui/client'
import { Transaction } from '@mysten/sui/transactions'

import { clmmSDKOption } from '../cetus-config'
import * as config from '../config';
import { getWalletFromPrivateKey } from './wallet';

const suiClient = new SuiClient({
    url: clmmSDKOption.fullRpcUrl,
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

export const transferSUI = async (txb: Transaction | null, pkey: string, destWallet: string, amount: number, sendMsg: Function, callback: Function) => {

    console.log('Transfering SUI...');
    const walletInfo: any | null = getWalletFromPrivateKey(pkey)
    if (!walletInfo) {
        sendMsg(`❗ Transfer failed: Invalid wallet.`)
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

    txb.transferObjects([splitedInputCoins], destWallet);

    return { txb };
}

export const disperseSUI = async (depositWallet: any, wallets: any[], amounts: number[]) => {
    const tx = new Transaction();

    // first, split the gas coin into multiple coins
    const coins = tx.splitCoins(
        tx.gas,
        amounts,
    );

    // next, create a transfer transaction for each coin
    for (let i = 0; i < wallets.length; i++) {
        tx.transferObjects([coins[i]], wallets[i].publicKey);
    }
    const transferTxn = await clmmSDKOption.fullClient.sendTransaction(depositWallet.wallet, tx);

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
        const senderCoin = await clmmSDKOption.fullClient.getCoins({ owner: wallets[i].publicKey, coinType: config.SUI_COIN_TYPE });
        for (let j = 0; j < senderCoin.data.length; j++) {
            coinObjectIds.push(senderCoin.data[j].coinObjectId)
        }
        console.log(`coinObjectIds: ${coinObjectIds}`);
        for (let i = 0; i < coinObjectIds.length; i++) {
            tx.transferObjects([coinObjectIds[i]], depositWallet.publicKey);
        }
        tx.setSender(wallets[i].publicKey);
        tx.setGasOwner(depositWallet.publicKey);

        const kindBytes = await tx.build({ client: clmmSDKOption.fullClient });
        const sponsorSig = await depositWallet.wallet.signTransaction(kindBytes);
        const senderSig = await wallets[i].wallet.signTransaction(kindBytes);
        console.log(`tx: ${await tx.toJSON()}`);

        try {
            const result = await clmmSDKOption.fullClient.executeTransactionBlock({
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
