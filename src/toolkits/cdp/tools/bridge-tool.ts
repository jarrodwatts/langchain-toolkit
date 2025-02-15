import { z } from "zod";
import { BrianCDPTool } from "./tool.js";
import { BrianSDK } from "@brian-ai/sdk";
import { erc20Abi } from "viem";
import { Coinbase, type Wallet } from "@coinbase/coinbase-sdk";
import {
  BUNGEE_ROUTER_ABI,
  decodeFunctionDataForCdp,
  ENSO_ROUTER_ABI,
  getAddressFromWallet,
  LIFI_ROUTER_ABI,
} from "./utils";

const bridgeToolSchema = z.object({
  tokenIn: z.string(),
  inputChain: z.string(),
  outputChain: z.string(),
  amount: z.string(),
});

export const createCDPBridgeTool = (brianSDK: BrianSDK, wallet: Wallet) => {
  return new BrianCDPTool({
    name: "bridge",
    description:
      "bridges the amount of tokenIn from the inputChain to the outputChain",
    schema: bridgeToolSchema,
    brianSDK,
    wallet,
    func: async ({ tokenIn, inputChain, outputChain, amount }) => {
      const prompt = `Bridge ${amount} ${tokenIn} from ${inputChain} to ${outputChain}`;

      const address = await getAddressFromWallet(wallet);

      const brianTx = await brianSDK.transact({
        prompt,
        address,
      });
      if (brianTx.length === 0) {
        return "Whoops, could not perform the bridge, an error occurred while calling the Brian APIs.";
      }

      const [tx] = brianTx;
      const { solver, data } = tx;

      //check if there are any steps
      const txStepsLength = data.steps!.length;
      if (txStepsLength === 0) {
        return "No transaction to be executed from this prompt. Maybe you should try with another one?";
      }

      const approveNeeded = data.steps!.length > 1;

      if (approveNeeded) {
        const [decodedData, functionName] = decodeFunctionDataForCdp(
          erc20Abi,
          data.steps![0].data
        );
        //make approve
        const erc20ApproveTx = await wallet.invokeContract({
          contractAddress: data.steps![0].to,
          method: functionName,
          abi: erc20Abi,
          args: decodedData,
        });
        await erc20ApproveTx.wait();
      }
      //retrieve swap data
      const solverAbi =
        solver === "Enso"
          ? ENSO_ROUTER_ABI
          : solver === "Bungee"
          ? BUNGEE_ROUTER_ABI
          : LIFI_ROUTER_ABI;

      //decode data according to CDP sdk
      const [decodedData, functionName] = decodeFunctionDataForCdp(
        solverAbi,
        data.steps![data.steps!.length - 1].data
      );
      //make swap
      const bridgeTx = await wallet.invokeContract({
        contractAddress: data.steps![data.steps!.length - 1].to,
        method: functionName,
        abi: solverAbi,
        args: decodedData,
        amount: BigInt(data.steps![data.steps!.length - 1].value),
        assetId: Coinbase.assets.Wei,
      });
      const receipt = await bridgeTx.wait();
      const txLink = receipt.getTransactionLink();

      console.log(
        `Transaction executed successfully, this is the transaction link: ${txLink}`
      );
      return `Bridge executed successfully! I've moved ${amount} of ${tokenIn} from ${inputChain} to ${outputChain}.`;
    },
  });
};
