import { adjustForSlippage, Percentage, d, Pool } from "@cetusprotocol/cetus-sui-clmm-sdk";

import BN from 'bn.js'

import { getTokenBalance, sleep } from './index'
import { cetusClmmSDK } from '../cetus-config'

export async function getPoolByCoin(coinType: string) {
    try {
        const pools = await cetusClmmSDK.Pool.getPoolsWithPage([])
        console.log(`pool length: ${pools.length}`)

        for (const pool of pools) {
            if (pool.coinTypeA === coinType) {
                return pool;
            }
        }
    } catch (err) {
        console.error('get pool by coin error:', err);
    }

    return null;
}

export async function fetchPool(poolAddress: string): Promise<Pool> {
    const pool = await cetusClmmSDK.Pool.getPool(poolAddress)
    return pool;
}

export async function buySwap(wallet: any, amount: BN, slippage_percent: number, poolAddress: string): Promise<boolean> {
    const pool = await fetchPool(poolAddress);
    
    const coinAMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: pool.coinTypeA });
    const coinBMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: pool.coinTypeB });

    const a2b = false; // Buy swap (SUI to token)
    const byAmountIn = true;

    const slippage = Percentage.fromDecimal(d(slippage_percent));

    const res: any = await cetusClmmSDK.Swap.preswap({
        pool: pool,
        currentSqrtPrice: pool.current_sqrt_price,
        coinTypeA: pool.coinTypeA,
        coinTypeB: pool.coinTypeB,
        decimalsA: coinAMetadata?.decimals || 9,
        decimalsB: coinBMetadata?.decimals || 9,
        a2b, // Buy
        byAmountIn,
        amount: amount.toString(),
    });
    
    console.log(`preswap result: ${JSON.stringify(res)}`);
    
    const toAmount = byAmountIn ? res.estimatedAmountOut : res.estimatedAmountIn;
    const amountLimit = adjustForSlippage(new BN(toAmount), slippage, !byAmountIn);

    console.log(`toAmount = ${toAmount}, amountLimit = ${amountLimit}`);

    cetusClmmSDK.senderAddress = wallet.publicKey;

    const transactionBlock = await cetusClmmSDK.Swap.createSwapTransactionPayload({
        pool_id: pool.poolAddress,
        coinTypeA: pool.coinTypeA,
        coinTypeB: pool.coinTypeB,
        a2b,
        by_amount_in: byAmountIn,
        amount: res.amount.toString(),
        amount_limit: amountLimit.toString(),
    });

    transactionBlock.setGasBudget(10000000)
    
    transactionBlock.setSender(wallet.publicKey);
    transactionBlock.setGasOwner(wallet.publicKey);

    const kindBytes = await transactionBlock.build({ client: cetusClmmSDK.fullClient });
    const sponsorSign = await wallet.wallet.signTransaction(kindBytes);
    const senderSign = await wallet.wallet.signTransaction(kindBytes);
    let swapTxn;

    // Retry logic for locked objects
    let retries = 3;
    while (retries > 0) {
        try {
            // swapTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet, transactionBlock);
            swapTxn = await cetusClmmSDK.fullClient.executeTransactionBlock({
                transactionBlock: kindBytes,
                signature: [senderSign.signature, sponsorSign.signature],
                options: {
                    showEffects: false,
                    showBalanceChanges: true,
                    showEvents: false,
                    showInput: false,
                    showObjectChanges: false,
                },
            });
            console.log(swapTxn);
            break;
        } catch (error) {
            console.warn(`Error occurred during buy swap, retrying...`);
            await sleep(2000); // wait before retrying
            retries--;
        }
    }
    
    if (!swapTxn) {
        console.error(`Error while sending buy swap transaction after retries`);
        return false;
    }
    return true;
} 

export async function sellSwap(wallet: any, amount: BN, slippage_percent: number, poolAddress:string): Promise<boolean> {
    const pool = await fetchPool(poolAddress);
    
    const coinAMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: pool.coinTypeA });
    const coinBMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: pool.coinTypeB });

    const sellA2B = true; // Sell swap (token to SUI)
    const byAmountIn = true;

    const slippage = Percentage.fromDecimal(d(slippage_percent));

    const tokenBalance = await getTokenBalance(wallet.publicKey, pool.coinTypeA);
    if (!tokenBalance || new BN(tokenBalance.totalBalance).lt(amount)) {
        console.error(`No tokens available for selling in wallet: ${wallet.publicKey}`);
        return false;
    }

    console.log(`Sell Token Amount: ${tokenBalance.totalBalance}`);
    const coinAmount = amount;

    const res: any = await cetusClmmSDK.Swap.preswap({
        pool: pool,
        currentSqrtPrice: pool.current_sqrt_price,
        coinTypeA: pool.coinTypeA,
        coinTypeB: pool.coinTypeB,
        decimalsA: coinAMetadata?.decimals || 9,
        decimalsB: coinBMetadata?.decimals || 9,
        a2b: sellA2B, // Sell
        byAmountIn,
        amount: coinAmount.toString(),
    });

    const toAmount = byAmountIn ? res.estimatedAmountOut : res.estimatedAmountIn;
    const amountLimit = adjustForSlippage(new BN(toAmount), slippage, !byAmountIn);

    cetusClmmSDK.senderAddress = wallet.publicKey;

    const transactionBlock = await cetusClmmSDK.Swap.createSwapTransactionPayload({
        pool_id: pool.poolAddress,
        coinTypeA: pool.coinTypeA,
        coinTypeB: pool.coinTypeB,
        a2b: sellA2B,
        by_amount_in: byAmountIn,
        amount: res.amount.toString(),
        amount_limit: amountLimit.toString(),
    });

    transactionBlock.setSender(wallet.publicKey);
    transactionBlock.setGasOwner(wallet.publicKey);

    const kindBytes = await transactionBlock.build({ client: cetusClmmSDK.fullClient });
    const sponsorSign = await wallet.wallet.signTransaction(kindBytes);
    const senderSign = await wallet.wallet.signTransaction(kindBytes);

    let sellSwapTxn;

    // Retry logic for locked objects
    let retries = 3;
    while (retries > 0) {
        try {
            // sellSwapTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet, transactionBlock);
            sellSwapTxn = await cetusClmmSDK.fullClient.executeTransactionBlock({
                transactionBlock: kindBytes,
                signature: [senderSign.signature, sponsorSign.signature],
                options: {
                    showEffects: false,
                    showBalanceChanges: true,
                    showEvents: false,
                    showInput: false,
                    showObjectChanges: false,
                },
            });
            console.log(sellSwapTxn);
            break;
        } catch (error) {
            console.warn(`Error occurred during sell swap, retrying...`);
            await sleep(2000); // wait before retrying
            retries--;
        }
    }

    if (!sellSwapTxn) {
        console.error(`Error while sending sell swap transaction after retries`);
        return false;
    }

    return true;
}