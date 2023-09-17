import * as xrpl from "xrpl";
import * as WrapABI from "../abi/WrapMintBurn.json";
import TokenABI from "../abi/ERC20.json";
import * as AccountsJSON from "../accounts.json";
import { ethers } from "ethers";

const SERVER = "wss://s.altnet.rippletest.net:51233";
const WRAP_ADDRESS = "0x5834683f869a419F68eD374bB79f7971F0d7F3Ed";
const TOKEN_ADDRESS = "0x18a4dEA0a6a1Ee76a1a88f65d74dfbdeb1fb1C8F";

const { accounts } = AccountsJSON;

async function main() {
  if (process.env.CHAIN?.toLowerCase() === "xrp") {
    // connect to server
    const client = new xrpl.Client(SERVER);
    await client.connect();

    // connect wallet
    const recipient = xrpl.Wallet.fromSeed(accounts.multisig.xrpl.seed);
    const sender = xrpl.Wallet.generate();
    await client.fundWallet(sender);

    const transaction: xrpl.Transaction = {
      TransactionType: "Payment",
      Account: sender.address,
      Amount: xrpl.xrpToDrops(1),
      Destination: recipient.address,
      // @ts-ignore
      DestinationTag: 1,
      Memos: [
        {
          Memo: {
            MemoData: accounts.user.eth.address.substring(2),
          },
        },
      ],
    };
    const payment = await client.autofill(transaction);

    const signed = sender.sign(payment);
    const tx = await client.submitAndWait(signed.tx_blob);
    console.log(`Transaction: ${tx}`);

    client.disconnect();
  } else {
    const provider = new ethers.providers.JsonRpcProvider(
      "https://ethereum-sepolia.blockpi.network/v1/rpc/public"
    );
    const userWallet = new ethers.Wallet(
      accounts.user.eth.privateKey,
      provider
    );
    const wrap = new ethers.Contract(
      WRAP_ADDRESS,
      WrapABI.abi,
      provider
    ).connect(userWallet);

    const token = new ethers.Contract(
      TOKEN_ADDRESS,
      TokenABI,
      provider
    ).connect(userWallet);

    await (
      await token.approve(WRAP_ADDRESS, ethers.constants.MaxUint256)
    ).wait();

    await (
      await wrap.deposit(
        "0x18a4dEA0a6a1Ee76a1a88f65d74dfbdeb1fb1C8F",
        "1000000",
        ethers.utils.zeroPad(
          ethers.utils.base58.decode(accounts.user.xrpl.address),
          32
        )
      )
    ).wait();

    console.log("Done.");
  }
}

main();
