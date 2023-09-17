import * as xrpl from "xrpl";
import { ethers } from "ethers";
import * as WrapABI from "./abi/WrapMintBurn.json";
import * as AccountsJSON from "./accounts.json";
import { RedisClientType, createClient } from "redis";
import { acquireLock, delay, releaseLock } from "./lib/utils";

const SERVER = "wss://s.altnet.rippletest.net:51233";
const WRAP_ADDRESS = "0x6Af3bb511B4cD7206861817BbdadcfC4627d9cAB";
const WRAP_TOKEN = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";

const { accounts } = AccountsJSON;

if (
  typeof process.env.VALIDATOR_IDX !== "string" ||
  parseInt(process.env.VALIDATOR_IDX) >= accounts.validators.length ||
  parseInt(process.env.VALIDATOR_IDX) < 0
) {
  throw new Error("VALIDATOR_IDX invalid.");
}

const destinationTagMap: { [key: number]: { eth: string; xrpl: string } } = {
  1: {
    eth: accounts.user.eth.address,
    xrpl: accounts.user.xrpl.address,
  },
};

class Bridge {
  private source: xrpl.Client;
  private target: ethers.providers.JsonRpcProvider;
  private wrapMintBurn: ethers.Contract;
  private wallet: { eth: ethers.Wallet; xrpl: xrpl.Wallet };
  private redisClient: RedisClientType;
  private nextExecutionIndex: number;
  private startBlockNumber: number;

  constructor() {
    this.source = new xrpl.Client(SERVER);
    this.target = new ethers.providers.JsonRpcProvider(
      "https://eth-sepolia.g.alchemy.com/v2/demo"
    );
    this.wallet = {
      eth: new ethers.Wallet(
        accounts.validators[
          +(process.env.VALIDATOR_IDX as string)
        ].eth.privateKey,
        this.target
      ),
      xrpl: xrpl.Wallet.fromSeed(
        accounts.validators[+(process.env.VALIDATOR_IDX as string)].xrpl.seed
      ),
    };
    this.wrapMintBurn = new ethers.Contract(
      WRAP_ADDRESS,
      WrapABI.abi,
      this.target
    ).connect(this.wallet.eth);
    this.nextExecutionIndex = 0;
    this.startBlockNumber = 0;
    this.redisClient = createClient();
  }

  async initRpcConnections() {
    await Promise.all([this.source.connect(), this.redisClient.connect()]);
    this.nextExecutionIndex = (
      await this.wrapMintBurn.nextExecutionIndex()
    ).toNumber();
    this.startBlockNumber = (await this.target.getBlock("latest")).number;
  }

  async wrap(recipient: string, amount: string) {
    const block = await this.target.getBlock(-10);
    const tx = await this.wrapMintBurn.approveExecute(
      this.nextExecutionIndex,
      WRAP_TOKEN,
      amount,
      recipient,
      block.hash,
      block.number,
      { gasLimit: 10000000 }
    );
    await tx.wait();
    ++this.nextExecutionIndex;
    console.log(
      `Approving deposit:\nAmount: ${amount} XRP drops\nRecipient: ${recipient}`
    );
  }

  async unWrap(depositId: number, recipient: string, amount: string) {
    const redisKey = `deposit:${depositId}:transaction`;
    let transaction: xrpl.Payment;
    let signers = [];
    const multisig = xrpl.Wallet.fromSeed(accounts.multisig.xrpl.seed);

    try {
      await acquireLock(this.redisClient, depositId);
      console.log(
        `Signing unwrapping:\nDeposit ID: ${depositId}\nAmount: ${amount} drops\nRecipient: ${recipient}`
      );

      const transactionStr = await this.redisClient.get(redisKey);
      // create transaction or recover it
      if (transactionStr === null) {
        transaction = await this.source.autofill({
          TransactionType: "Payment",
          Account: multisig.address,
          Amount: amount,
          Destination: recipient,
          SigningPubKey: "",
        });
        transaction.Fee = (
          +(transaction.Fee || 1) *
          (accounts.validators.length + 1)
        ).toString();
      } else {
        transaction = JSON.parse(transactionStr) as xrpl.Payment;
        signers = transaction.Signers as any[];
      }

      // check if it is already signed
      if (!signers.find((s) => s.Signer.Account === this.wallet.xrpl.address)) {
        delete transaction.Signers;

        // create new signature
        const signed = this.wallet.xrpl.sign(transaction, true);
        transaction = xrpl.decode(signed.tx_blob) as unknown as xrpl.Payment;
        // @ts-ignore
        signers.push(transaction.Signers[0]); // add new signature in signers array
        // replace signers array to include all signatures, sorted
        transaction.Signers = signers.sort((a, b) =>
          a.Signer.Account.localeCompare(b.Signer.Account)
        );

        // save transaction with new signature
        await this.redisClient.set(redisKey, JSON.stringify(transaction));
      }
      await releaseLock(this.redisClient, depositId);

      // TODO: shouldn't be hardcoded
      if (signers.length == accounts.validators.length) {
        console.log(
          `Executing unwrapping:\nDeposit ID: ${depositId}\nAmount: ${amount} drops\nRecipient: ${recipient}`
        );
        await this.source.submitAndWait(transaction);
      }
    } catch (e) {
      await this.redisClient.del(
        `${this.wallet.eth.address}:${depositId}:sign`
      );
    }
  }

  async startEthWatcher() {
    console.log("Starting ETH watcher..");
    while (1) {
      // TODO: use proper bounds
      const events = await this.wrapMintBurn.queryFilter(
        this.wrapMintBurn.filters.Deposit(),
        this.startBlockNumber
      );

      for (const { args } of events) {
        // @ts-ignore
        const { id, amount, to } = args;

        // check if this deposit is already approved
        const res = await this.redisClient.set(
          `${this.wallet.eth.address}:${id.toNumber()}:sign`,
          1,
          {
            NX: true,
          }
        );
        if (res === "OK") {
          this.unWrap(
            id.toNumber(),
            destinationTagMap[parseInt(to, 16)].xrpl,
            amount.toString()
          );
        }
      }
      await delay(500);
    }
  }

  async startXrpWatcher() {
    console.log("Starting XRPL watcher..");
    const multisig = xrpl.Wallet.fromSeed(accounts.multisig.xrpl.seed);

    await this.source.request({
      command: "subscribe",
      accounts: [multisig.address],
    });
    this.source.on("transaction", (tx) => {
      const payment: xrpl.Payment = tx.transaction as xrpl.Payment;
      if (payment.Destination !== multisig.address) {
        // ignore outgoing payments
        return;
      }

      if (!payment.Amount || !payment.Memos || !payment.Memos.length) {
        console.error("ERROR: Invalid transaction");
        console.log(JSON.stringify(tx));
        return;
      }

      if (!tx.validated) {
        console.warn("WARNING: Transaction not yet validated.");
      }

      this.wrap(
        "0x" + payment.Memos[0].Memo.MemoData,
        payment.Amount as string
      );
    });
  }
}

async function main() {
  const bridge = new Bridge();
  await bridge.initRpcConnections();
  await Promise.all([bridge.startEthWatcher(), bridge.startXrpWatcher()]);
}

main();
