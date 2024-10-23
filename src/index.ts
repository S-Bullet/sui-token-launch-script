import { createToken, disperseSUI, disperseToken, transferSUI, transferToken } from "./utils";
import * as dotenv from "dotenv"
import { getWalletFromPrivateKey } from "./utils/wallet";
import { buySwap, createPool, createPoolWithInitialLiquidity, getPoolByCoin } from "./utils/cetus";
dotenv.config();

const wallet = getWalletFromPrivateKey(process.env.PRIVATE_KEY as string);

const main = async () => {

    let tokenTypeA = '0x7689aa0c665a63dcbab283e6432ab390326651f01a849ad5be7e01dcd5b4270d::mpt::MPT';
    let tokenTypeB = '0xb9e7b2eab7f9172a01196ac00f2ab5c9358e448e4c171becdabb2deff3f2e050::mpt::MPT';
    if (false) {
        tokenTypeA = await createToken(
                                                    wallet.wallet,        
                                                    'Token-A',
                                                    '$A',
                                                    9,
                                                    'This is the test to create sui meme coin.',
                                                    4_444_444_444,
                                                    'https://seapad.s3.ap-southeast-1.amazonaws.com/uploads/TEST/public/media/images/logo_1679906850804.png'
                                                );
        console.log('new Token Type : ', tokenTypeA);
        
        tokenTypeB = await createToken(
                                                    wallet.wallet,        
                                                    'Token-B',
                                                    '$B',
                                                    9,
                                                    'This is the test to create sui meme coin.',
                                                    7_000_000_000,
                                                    'https://seapad.s3.ap-southeast-1.amazonaws.com/uploads/TEST/public/media/images/logo_1679906850804.png'
                                                );
        console.log('new Token Type : ', tokenTypeB);
    }

    let poolAddr = '0x26f072cd0def22fd7a3a233a1544cba6fd62c440a228d08f032477ed652aa042'
    if (false) {
        poolAddr = await createPoolWithInitialLiquidity(
            wallet,
            tokenTypeA,
            tokenTypeB,
            1_000_000_000,
            2,
            0.05,
            true
        );
    }

    await buySwap(wallet, 100000, 10, poolAddr);
}

main();