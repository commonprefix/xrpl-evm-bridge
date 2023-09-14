import { ethers } from "ethers";
import * as xrpl from "xrpl";

// TODO: Write in accounts.json
async function main() {
  if (process.env.CHAIN?.toLowerCase() === "xrp") {
    const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
    await client.connect();

    // create wallets
    const wallets = Array(4)
      .fill(0)
      .map(() => xrpl.Wallet.generate());
    const [user, multisig, ...validators] = wallets;

    // fund wallets
    for (const wallet of wallets) {
      await client.fundWallet(wallet);
    }

    // prepare multisig params
    const signerEntries: xrpl.SignerEntry[] = validators.map((w) => ({
      SignerEntry: {
        Account: w.address,
        SignerWeight: 1,
      },
    }));
    const transaction: xrpl.SignerListSet = {
      TransactionType: "SignerListSet",
      Account: multisig.address,
      SignerQuorum: 2,
      SignerEntries: signerEntries,
    };
    // TODO: Disable master key pair.
    // https://xrpl.org/disable-master-key-pair.html

    // submit transaction
    const prepared = await client.autofill(transaction);
    const signed = multisig.sign(prepared);
    const tx = await client.submitAndWait(signed.tx_blob);

    console.log("Validator 1");
    console.log(validators[0]);
    console.log("Validator 2");
    console.log(validators[1]);
    console.log("Multisig");
    console.log(multisig);
    console.log("User");
    console.log(user);

    await client.disconnect();
  } else {
    const wallets = Array(3)
      .fill(0)
      .map(() => ethers.Wallet.createRandom());

    console.log("WARNING: No funds.");
    console.log("Validator 1");
    console.log(wallets[0]);
    console.log("Validator 2");
    console.log(wallets[1]);
    console.log("User");
    console.log(wallets[2]);
  }
}

main();
