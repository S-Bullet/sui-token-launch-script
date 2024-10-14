import { adjustForSlippage, Percentage, d, Pool, TickMath, printTransaction, ClmmPoolUtil } from "@cetusprotocol/cetus-sui-clmm-sdk";

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

export const createPool = async (
    wallet: any, 
    coin_type_a: string, 
    coin_type_b: string
) => {
    cetusClmmSDK.senderAddress = wallet.getPublicKey().toSuiAddress()
    const tick_spacing = 2
    const initialize_price = 1
    const coin_a_decimals = 6
    const coin_b_decimals = 6
    // const coin_type_a = `${cetusClmmSDK.sdkOptions.faucet?.package_id}::usdt::USDT`
    // const coin_type_b = `${cetusClmmSDK.sdkOptions.faucet?.package_id}::usdc::USDC`

    const creatPoolTransactionPayload = await cetusClmmSDK.Pool.creatPoolsTransactionPayload([
      {
        tick_spacing: tick_spacing,
        initialize_sqrt_price: TickMath.priceToSqrtPriceX64(d(initialize_price), coin_a_decimals, coin_b_decimals).toString(),
        uri: '',
        coinTypeA: coin_type_a,
        coinTypeB: coin_type_b,
      },
    ])

    printTransaction(creatPoolTransactionPayload)
    const transferTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet, creatPoolTransactionPayload)
    console.log('createPool: ', transferTxn)
}

export const createPoolAndLiquidity = async (
    wallet: any,
    coin_type_a: string, 
    coin_type_b: string
) => {
    cetusClmmSDK.senderAddress = wallet.getPublicKey().toSuiAddress();

    const initialize_sqrt_price = TickMath.priceToSqrtPriceX64(d(0.3), 6, 6).toString();
    const tick_spacing = 2
    const current_tick_index = TickMath.sqrtPriceX64ToTickIndex(new BN(initialize_sqrt_price))
    
    const lowerTick = TickMath.getPrevInitializableTickIndex(new BN(current_tick_index).toNumber(), new BN(tick_spacing).toNumber())
    const upperTick = TickMath.getNextInitializableTickIndex(new BN(current_tick_index).toNumber(), new BN(tick_spacing).toNumber())

    // const coin_type_a = `${sdk.sdkOptions.faucet?.package_id}::usdt::USDT`
    // const coin_type_b = `{sdk.sdkOptions.faucet?.package_id}::usdc::USDC`
    
    const fix_coin_amount = new BN(200)
    const fix_amount_a = true
    const slippage = 0.05

    const liquidityInput = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
        lowerTick,
        upperTick,
        fix_coin_amount,
        fix_amount_a,
        true,
        slippage,
        new BN(initialize_sqrt_price)
      )
  
    const amount_a = fix_amount_a ? fix_coin_amount.toNumber() : liquidityInput.tokenMaxA.toNumber()
    const amount_b = fix_amount_a ? liquidityInput.tokenMaxB.toNumber() : fix_coin_amount.toNumber()
  
    console.log('amount: ', { amount_a, amount_b })

    const creatPoolTransactionPayload = await cetusClmmSDK.Pool.creatPoolTransactionPayload({
        tick_spacing: tick_spacing,
        initialize_sqrt_price: initialize_sqrt_price,
        uri: '',
        coinTypeA: coin_type_a,
        coinTypeB: coin_type_b,
        amount_a: amount_a,
        amount_b: amount_b,
        slippage,
        fix_amount_a: fix_amount_a,
        tick_lower: lowerTick,
        tick_upper: upperTick,
    })

    const transferTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet(), creatPoolTransactionPayload)
    console.log('doCreatPool: ', transferTxn)
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