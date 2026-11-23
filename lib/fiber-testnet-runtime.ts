
import type { FiberWasmFactory } from '@fiber-pay/sdk/browser';

// Fiber v0.10.1's obsolete Testnet CKB Auth dependency.
const obsoleteAuthTx =
  '0x5a5288769cecde6451cb5d301416c297a6da43dc3ac2f3253542b4082478b19b';

// Current Testnet CKB Auth transaction.
const testnetAuthTx =
  '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7';

const oldRpc = 'https://testnet.ckbapp.dev/';
const newRpc = 'https://testnet.ckb.dev/';

export async function createTestnetFiberFactory(): Promise<FiberWasmFactory> {
  const { Fiber } = await import('@nervosnetwork/fiber-js');

  return () => {
    const fiber = new Fiber();

    return {
      start: (config, ...args) => {
        let currentConfig = config;

        if (/chain:\s*testnet\b/.test(currentConfig)) {
          // Correct the Testnet Auth dependency.
          currentConfig = currentConfig.replaceAll(
            obsoleteAuthTx,
            testnetAuthTx
          );

          // Use the RPC endpoint where we confirmed the FundingLock cell.
          currentConfig = currentConfig.replaceAll(oldRpc, newRpc);
        }

        console.log(
          '[CipherGate] Fiber CKB RPC:',
          currentConfig.match(/rpc_url:\s*["']?([^"'\s]+)/)?.[1] ??
            'RPC URL not found'
        );

        console.log(
          '[CipherGate] FundingLock Type ID present:',
          currentConfig.includes(
            '3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6'
          )
        );

        return fiber.start(currentConfig, ...args);
      },

      stop: () => fiber.stop(),

      invokeCommand: (name, args) =>
        fiber.invokeCommand(name, args),
    };
  };
}
