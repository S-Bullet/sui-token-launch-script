import { adjustForSlippage, Percentage, d, Pool, TickMath, printTransaction, CreatePoolParams, ClmmPoolUtil, CreatePoolAddLiquidityParams } from "@cetusprotocol/cetus-sui-clmm-sdk";
import { BN } from 'bn.js'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'

import { getTokenBalance, sleep } from './index'
import { mainnetSDK as cetusClmmSDK } from './init_mainnet_sdk'
import { MAX_TICK_RANGE, TICK_SPACING } from "./cetus-config";

const suiClient = new SuiClient({
    url: getFullnodeUrl("mainnet"),
});

export const createPool = async (
    wallet: any, 
    coin_type_a: string, 
    coin_type_b: string
) => {
    cetusClmmSDK.senderAddress = wallet.publicKey
    const tick_spacing = TICK_SPACING
    const initialize_price = 1.01
    const coin_a_decimals = 6
    const coin_b_decimals = 6
    // const coin_type_a = `${cetusClmmSDK.sdkOptions.faucet?.package_id}::usdt::USDT`
    // const coin_type_b = `${cetusClmmSDK.sdkOptions.faucet?.package_id}::usdc::USDC`

    const paramss: CreatePoolParams = {
        tick_spacing: tick_spacing,
        initialize_sqrt_price: TickMath.priceToSqrtPriceX64(
            d(initialize_price),
            coin_a_decimals,
            coin_b_decimals
        ).toString(),
        uri: '',
        coinTypeA: coin_type_a,
        coinTypeB: coin_type_b,
    }

    const creatPoolTransactionPayload = await cetusClmmSDK.Pool.creatPoolsTransactionPayload([paramss])

    printTransaction(creatPoolTransactionPayload)
    const transferTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet, creatPoolTransactionPayload)
    // console.log('createPool: ', JSON.stringify(transferTxn))

    //@ts-ignore
    const poolAddr = transferTxn.events.parsedJson.pool_id;

    return poolAddr;
}

export const createPoolWithInitialLiquidity = async (
    wallet: any,
    coin_type_a: string, 
    coin_type_b: string, 
    coin_amount: number,
    initialize_price: number,
    slippage: number,
    is_full_range?: boolean
): Promise<string> => {
    cetusClmmSDK.senderAddress = wallet.publicKey;

    const tick_spacing = TICK_SPACING
    
    const coinAMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: coin_type_a });
    const coinBMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: coin_type_b });

    const coin_a_decimals = coinAMetadata?.decimals || 9
    const coin_b_decimals = coinBMetadata?.decimals || 9

    const initialize_sqrt_price = TickMath.priceToSqrtPriceX64(d(initialize_price), coin_a_decimals, coin_b_decimals).toString();
    const current_tick_index = TickMath.sqrtPriceX64ToTickIndex(new BN(initialize_sqrt_price))
    
    const fullTick = Math.floor(MAX_TICK_RANGE / TICK_SPACING) * TICK_SPACING;
    const lowerTick = is_full_range? -fullTick : TickMath.getPrevInitializableTickIndex(new BN(current_tick_index).toNumber(), new BN(tick_spacing).toNumber())
    const upperTick = is_full_range? fullTick : TickMath.getNextInitializableTickIndex(new BN(current_tick_index).toNumber(), new BN(tick_spacing).toNumber())

    // const coin_type_a = `${sdk.sdkOptions.faucet?.package_id}::usdt::USDT`
    // const coin_type_b = `{sdk.sdkOptions.faucet?.package_id}::usdc::USDC`
    
    const fix_coin_amount = new BN(coin_amount * Math.pow(10, coin_a_decimals))
    const fix_amount_a = true
    const curSqrtPrice = new BN(initialize_sqrt_price)

    const liquidityInput = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
        lowerTick,
        upperTick,
        fix_coin_amount,
        fix_amount_a,
        true,
        slippage,
        curSqrtPrice
      )
  
    const amount_a = fix_amount_a ? fix_coin_amount.toNumber() : liquidityInput.tokenMaxA.toNumber()
    const amount_b = fix_amount_a ? liquidityInput.tokenMaxB.toNumber() : fix_coin_amount.toNumber()
  
    // console.log('A: ', coin_type_a)
    // console.log('B: ', coin_type_b)
    // console.log('tick_spacing: ', tick_spacing)
    // console.log('initialize_sqrt_price: ', initialize_sqrt_price)
    // console.log('amount: ', { amount_a, amount_b })
    // console.log('fix_amount_a: ', fix_amount_a)
    // console.log('amount: ', { lowerTick, upperTick })
    // console.log('slippage: ', slippage)

    const paramss: CreatePoolAddLiquidityParams = {
        coinTypeA: coin_type_a,
        coinTypeB: coin_type_b,
        tick_spacing: tick_spacing,
        initialize_sqrt_price: initialize_sqrt_price,
        uri: '',
        amount_a: amount_a,
        amount_b: amount_b,
        fix_amount_a: fix_amount_a,
        tick_lower: lowerTick,
        tick_upper: upperTick,
        slippage
    }

    const creatPoolTransactionPayload = await cetusClmmSDK.Pool.creatPoolTransactionPayload(paramss);

    printTransaction(creatPoolTransactionPayload)
    // const transferTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet, creatPoolTransactionPayload)
    const response = await suiClient.signAndExecuteTransaction({ 
        signer: wallet.wallet, 
        transaction: creatPoolTransactionPayload 
    });    
    const result = await suiClient.waitForTransaction({ 
        digest: response.digest,
        options: {
            showEffects: true,
        }
    })
    console.log('createPool: ', JSON.stringify(result))
    console.log('createPool: ', result)
    
    //@ts-ignore
    for (const created of result.effects.created) {
        if (created.owner) {
            return created.reference.objectId;
        }
    }

    return '';
}

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

export async function buySwap(wallet: any, amount: number, slippage_percent: number, poolAddress: string): Promise<boolean> {
    const pool = await cetusClmmSDK.Pool.getPool(poolAddress);
    
    // console.log(pool);

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
    // transactionBlock.setGasBudget(10000000)
    
    // transactionBlock.setSender(wallet.publicKey);
    // transactionBlock.setGasOwner(wallet.publicKey);

    // const kindBytes = await transactionBlock.build({ client: cetusClmmSDK.fullClient });
    // const sponsorSign = await wallet.wallet.signTransaction(kindBytes);
    // const senderSign = await wallet.wallet.signTransaction(kindBytes);
    let swapTxn;

    // Retry logic for locked objects
    let retries = 3;
    while (retries > 0) {
        try {
            swapTxn = await cetusClmmSDK.fullClient.sendTransaction(wallet.wallet, transactionBlock);
            // swapTxn = await cetusClmmSDK.fullClient.executeTransactionBlock({
            //     transactionBlock: kindBytes,
            //     signature: [senderSign.signature, sponsorSign.signature],
            //     options: {
            //         showEffects: false,
            //         showBalanceChanges: true,
            //         showEvents: false,
            //         showInput: false,
            //         showObjectChanges: false,
            //     },
            // });
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

export async function sellSwap(wallet: any, amount: number, slippage_percent: number, poolAddress:string): Promise<boolean> {
    const pool = await fetchPool(poolAddress);
    
    const coinAMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: pool.coinTypeA });
    const coinBMetadata = await cetusClmmSDK.fullClient.getCoinMetadata({ coinType: pool.coinTypeB });

    const sellA2B = true; // Sell swap (token to SUI)
    const byAmountIn = true;

    const slippage = Percentage.fromDecimal(d(slippage_percent));

    const tokenBalance = await getTokenBalance(wallet.publicKey, pool.coinTypeA);
    //@ts-ignore
    if (!tokenBalance && tokenBalance.totalBalance < amount) {
        console.error(`No tokens available for selling in wallet: ${wallet.publicKey}`);
        return false;
    }

    //@ts-ignore
    console.log(`Sell Token Amount: ${tokenBalance.totalBalance}`);
    const coinAmount = new BN(amount);

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