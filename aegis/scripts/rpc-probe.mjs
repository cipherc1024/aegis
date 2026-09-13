import { JsonRpcProvider } from "ethers";

const candidates = [
  "https://testnet-rpc.monad.xyz",
  "https://monad-testnet-rpc.publicnode.com",
  "https://rpc.ankr.com/monad_testnet",
  "https://monad-testnet.g.alchemy.com/v2/demo",
  "https://monad-testnet.drpc.org",
  "https:// Monad-testnet.rpc.thirdweb.com".trim().toLowerCase(),
];

for (const url of candidates) {
  const t0 = Date.now();
  try {
    const p = new JsonRpcProvider(url, undefined, { staticNetwork: true, pollingInterval: 300 });
    const [net, bn] = await Promise.all([p.getNetwork(), p.getBlockNumber()]);
    console.log("OK ", url, "chainId=" + net.chainId, "block=" + bn, (Date.now() - t0) + "ms");
  } catch (e) {
    console.log("FAIL", url, (e.shortMessage || e.message).slice(0, 80), (Date.now() - t0) + "ms");
  }
}
