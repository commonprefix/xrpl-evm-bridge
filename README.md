# XRPL<>EVM Bridge

> A simple bridge for wrapping XRP, the native token of the [XRPL Ledger](https://xrpl.org/), to EVM-compatible chains.

The purpose of this bridge is to demonstrate the feasibility of such a system and a way to learn more about the XRPL stack. It comes with many caveats that are mentioned below.

## Architecture

The entry point of the bridge is on the XRP Ledger. There exists a [multi-sig account](https://xrpl.org/multi-signing.html) that holds and releases funds as requested by users. On the EVM side of the bridge lies a partial deployment of the [Enosys Bridge](https://github.com/flrfinance/bridge-contracts), specifically the [WrapMintBurn](https://github.com/flrfinance/bridge-contracts/blob/main/src/WrapMintBurn.sol) contract. A typical ERC-20 token is also needed that will act as the wrapped version of the XRP token.

Off-chain there are Validator processes, written in TypeScript, that watch and sign transactions between the endpoints of the bridge. The number of validators required is specified during the deployment of WrapMintBurn and can also be configured during the lifetime of the bridge.

Below is an outline of the process of wrapping and un-wrapping tokens using the bridge:
- The user needs to acquire a Destination Tag from the Bridge Maintainer, mapping this tag to a destination address on the EVM side.
- The user deposits X amount of XRP to the multi-sig account on XRPL, specifying the Destination Tag provided by the Bridge Maintainer.
- The Validator processes watch for transactions on the multi-sig account and captures the user's deposit. They then approve this transaction on the EVM side. Once the transaction has been approved by enough validators, it is executed and the user receives the wrapped token in their account.
- If the user decides to unwrap their tokens, they deposit the amount they want on the WrapMintBurn contract.
- The Validator processes again watch for deposits on the EVM side. Once they find a deposit, each of them signs a transaction for XRPL to return XRP to the user's wallet.
- Once enough signatures have been gathered, the transaction is submitted and the user receives XRP.

## Caveats
### Signature Gathering
In order for a multi-sig transaction to be executed, all the required signatures must be gathered before submitting the transaction on XRPL. There needs to be a mechanism to gather those transactions across Validators running on different machines/networks. This mechanism is out-of-scope for this project, so instead there was the assumption that the Validators will be running on the same machine and they are submitting their signatures in a Redis database. The last one to sign the transaction also submits it to XRPL.

### Ordered Execution of Transactions
The WrapMintBurn executes transactions sequentially. For example, deposit #2 cannot be executed before deposit #1. If a Validator finds and submits deposit #2 before deposit #1, then deposit #2 will never be executed. Deposit #1 will be executed, and there will be no retry for deposit #2. In that scenario, no other deposits will be executed after #1. It is best to complete a wrap before starting another one, to make sure that they will arrive in the proper order.

### Destination Tag Mapping
Currently, the only user input is the Destination Tag, which is very limiting. There needs to be a mapping between Destination Tags and recipient addresses to know where to send the funds on both sides of the bridge. This mapping is currently hardcoded in the Validator process code. Another option would be to use [Memos](https://xrpl.org/transaction-common-fields.html#memos-field) and pass an arbitrary address along with the deposit, eliminating the need for a mapping.

### Submission of Signatures
The XRPL transaction that the Validators sign includes a [Sequence](https://xrpl.org/basic-data-types.html#account-sequence) number, which is the number of the transaction for the multi-sig account. The gathering of the signatures takes some time, and there might be another transaction in between. If another transaction is executed from that multi-sig, then the multisigned transaction will not be able to be executed because the Sequence number will be outdated. It is best to complete an unwrapping before starting another one, to make sure that no other transactions will be executed until all the signatures have been gathered for a given unwrapping. To fix this, [Tickets](https://xrpl.org/tickets.html) could be used, allowing a transaction to be executed out of order.

## Setup
- Install NPM packages:
```bash
npm install
```
- Create the necessary accounts for XRP:
```bash
CHAIN=xrp npx ts-node lib/create-wallet.ts
```
- Create the necessary accounts for the EVM-compatible chain (currently hardcoded to Sepolia):
```bash
npx ts-node lib/create-wallet.ts
```
- Update accounts.json with the accounts that you just created.
- Fund the EVM-compatible wallets with some native tokens (eg: from a faucet). The XRPL wallets are already funded.
- Start a Redis Server on the default port
- The bridge is currently configured to run with 2 validators, so you will need 2 validator processes running in parallel:
```bash
VALIDATOR_IDX=0 npx ts-node validator.ts
```
```bash
VALIDATOR_IDX=1 npx ts-node validator.ts
```
- Both validators should be looking for transactions now. You can either manually try to send some XRP on the multi-sig account, or use the following helper script:
```bash
CHAIN=xrp npx ts-node lib/send.ts
```
- To test the unwrapping, either call `deposit()` on the WrapMintBurn contract or use the helper script:
```bash
npx ts-node lib/send.ts
```
