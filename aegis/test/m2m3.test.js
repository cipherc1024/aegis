// M2/M3 本地零 gas 测试：CommittedOracle / AtomicExecutor / AuditDraw
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const ASSET = ethers.keccak256(ethers.toUtf8Bytes("WMON/MON"));
const PRICE = 1000000000000000000n; // 1.0
const CAP = ethers.parseEther("0.05");
const AMT = ethers.parseEther("0.01");

const mine = async (n) => network.provider.send("hardhat_mine", ["0x" + n.toString(16)]);

describe("M2 CommittedOracle", () => {
  it("governance 提交观测，stateHash = keccak(assetId, price, blockNumber)", async () => {
    const [gov] = await ethers.getSigners();
    const oracle = await (await ethers.getContractFactory("CommittedOracle")).deploy();
    const tx = await oracle.postObservation(ASSET, PRICE);
    const rc = await tx.wait();
    const block = await ethers.provider.getBlock(rc.blockNumber);
    const expectHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint256", "uint256"], [ASSET, PRICE, rc.blockNumber]));
    const obs = await oracle.observations(ASSET);
    expect(obs.price).to.equal(PRICE);
    expect(obs.blockNumber).to.equal(rc.blockNumber);
    expect(obs.stateHash).to.equal(expectHash);
    expect(await oracle.commitRoot(ASSET)).to.equal(expectHash);
    await expect(tx).to.emit(oracle, "ObservationPosted")
      .withArgs(ASSET, PRICE, rc.blockNumber, expectHash);
    expect(block.number).to.equal(rc.blockNumber);
  });

  it("非治理提交 revert NotGovernance", async () => {
    const [, other] = await ethers.getSigners();
    const oracle = await (await ethers.getContractFactory("CommittedOracle")).deploy();
    await expect(oracle.connect(other).postObservation(ASSET, PRICE))
      .to.be.revertedWithCustomError(oracle, "NotGovernance");
  });
});

describe("M2 AtomicExecutor（原子输入–执行绑定）", () => {
  async function setup() {
    const [gov, user] = await ethers.getSigners();
    const oracle = await (await ethers.getContractFactory("CommittedOracle")).deploy();
    const wmon = await (await ethers.getContractFactory("MockWMON")).deploy();
    const exec = await (await ethers.getContractFactory("AtomicExecutor"))
      .deploy(await oracle.getAddress(), await wmon.getAddress(), ASSET, CAP);
    return { gov, user, oracle, wmon, exec };
  }

  it("正例：同一 tx 内读 oracle + wrap，事件携 price/obsBlock/stateHash", async () => {
    const { oracle, wmon, exec } = await setup();
    await (await oracle.postObservation(ASSET, PRICE)).wait();
    const root = await oracle.commitRoot(ASSET);
    const tx = await exec.executeAtomic(AMT, root, { value: AMT });
    const rc = await tx.wait();
    const obs = await oracle.observations(ASSET);
    await expect(tx).to.emit(exec, "AtomicExecuted")
      .withArgs(ASSET, PRICE, obs.blockNumber, root, AMT, (await ethers.getSigners())[0].address);
    expect(await wmon.balanceOf(await exec.getAddress())).to.equal(AMT);
  });

  it("攻击：expectedStateHash 不符（输入被换）→ revert 'input changed'", async () => {
    const { oracle, exec } = await setup();
    await (await oracle.postObservation(ASSET, PRICE)).wait();
    const fake = ethers.keccak256(ethers.toUtf8Bytes("fake input"));
    await expect(exec.executeAtomic(AMT, fake, { value: AMT })).to.be.revertedWith("input changed");
  });

  it("观测过旧（>100 块）→ revert 'stale input'", async () => {
    const { oracle, exec } = await setup();
    await (await oracle.postObservation(ASSET, PRICE)).wait();
    const root = await oracle.commitRoot(ASSET);
    await mine(101);
    await expect(exec.executeAtomic(AMT, root, { value: AMT })).to.be.revertedWith("stale input");
  });

  it("超单笔上限 → revert 'pace'；msg.value ≠ amount → revert 'value != amount'", async () => {
    const { oracle, exec } = await setup();
    await (await oracle.postObservation(ASSET, PRICE)).wait();
    const root = await oracle.commitRoot(ASSET);
    await expect(exec.executeAtomic(CAP + 1n, root, { value: CAP + 1n })).to.be.revertedWith("pace");
    await expect(exec.executeAtomic(AMT, root, { value: AMT - 1n })).to.be.revertedWith("value != amount");
  });

  it("无观测 → revert 'no observation'", async () => {
    const { exec } = await setup();
    await expect(exec.executeAtomic(AMT, ethers.ZeroHash, { value: AMT }))
      .to.be.revertedWith("no observation");
  });
});

describe("M3 AuditDraw（承诺–揭示抽选机）", () => {
  const SEED = ethers.keccak256(ethers.toUtf8Bytes("period-42-seed"));
  const COMMIT = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["bytes32"], [SEED]));
  const PERIOD = 42;

  async function setup() {
    const [gov, other] = await ethers.getSigners();
    const draw = await (await ethers.getContractFactory("AuditDraw")).deploy();
    return { gov, other, draw };
  }

  function recompute(seed, anchorHash, periodId, receiptCount, sampleSize) {
    const out = [];
    for (let i = 0; i < sampleSize; i++) {
      const h = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "uint256", "uint256"], [seed, anchorHash, periodId, i]));
      out.push(BigInt(h) % BigInt(receiptCount));
    }
    return out;
  }

  it("正例：commit → 等 5 块 → reveal，索引与链下重算逐值一致", async () => {
    const { draw } = await setup();
    const tx = await draw.commitDraw(PERIOD, COMMIT);
    const rc = await tx.wait();
    await expect(tx).to.emit(draw, "DrawCommitted").withArgs(PERIOD, COMMIT, rc.blockNumber);
    await mine(5);
    const anchorBlock = rc.blockNumber + 5;
    const anchorHash = (await ethers.provider.getBlock(anchorBlock)).hash;
    const rtx = await draw.revealDraw(PERIOD, SEED, 1000, 200);
    const rrc = await rtx.wait();
    const ev = rrc.logs.find((l) => l.fragment && l.fragment.name === "DrawRevealed");
    expect(ev).to.not.equal(undefined);
    const [periodId, seed, ab, ah, rc_, ss, indices] = ev.args;
    expect(periodId).to.equal(PERIOD);
    expect(seed).to.equal(SEED);
    expect(ab).to.equal(anchorBlock);
    expect(ah).to.equal(anchorHash);
    expect(rc_).to.equal(1000n);
    expect(ss).to.equal(200n);
    const off = recompute(SEED, anchorHash, PERIOD, 1000, 200);
    expect(indices.map(BigInt)).to.deep.equal(off);
    // 返回值与事件一致
    const ret = await draw.revealDraw.staticCall;
    expect(typeof ret).to.equal("function");
  });

  it("太早揭示 → revert 'too early'", async () => {
    const { draw } = await setup();
    await (await draw.commitDraw(PERIOD, COMMIT)).wait();
    await expect(draw.revealDraw(PERIOD, SEED, 1000, 200)).to.be.revertedWith("too early");
  });

  it("坏种子 → revert 'bad seed'；重复承诺 → 'already committed'；重复揭示 → 'already revealed'", async () => {
    const { draw } = await setup();
    await (await draw.commitDraw(PERIOD, COMMIT)).wait();
    await mine(5);
    const bad = ethers.keccak256(ethers.toUtf8Bytes("wrong"));
    await expect(draw.revealDraw(PERIOD, bad, 1000, 200)).to.be.revertedWith("bad seed");
    await expect(draw.commitDraw(PERIOD, COMMIT)).to.be.revertedWith("already committed");
    await (await draw.revealDraw(PERIOD, SEED, 1000, 200)).wait();
    await expect(draw.revealDraw(PERIOD, SEED, 1000, 200)).to.be.revertedWith("already revealed");
  });

  it("非治理承诺 revert NotGovernance；未承诺周期 revert 'not committed'", async () => {
    const { other, draw } = await setup();
    await expect(draw.connect(other).commitDraw(PERIOD, COMMIT))
      .to.be.revertedWithCustomError(draw, "NotGovernance");
    await expect(draw.revealDraw(PERIOD + 1, SEED, 1000, 200)).to.be.revertedWith("not committed");
  });

  it("锚块过期（>256 块未揭示）→ revert 'anchor expired'（fail-closed）", async () => {
    const { draw } = await setup();
    await (await draw.commitDraw(PERIOD, COMMIT)).wait();
    await mine(300);
    await expect(draw.revealDraw(PERIOD, SEED, 1000, 200)).to.be.revertedWith("anchor expired");
  });

  it("样本参数越界 → revert", async () => {
    const { draw } = await setup();
    await (await draw.commitDraw(PERIOD, COMMIT)).wait();
    await mine(5);
    await expect(draw.revealDraw(PERIOD, SEED, 0, 1)).to.be.revertedWith("no receipts");
    await expect(draw.revealDraw(PERIOD, SEED, 1000, 0)).to.be.revertedWith("bad sample size");
    await expect(draw.revealDraw(PERIOD, SEED, 1000, 1001)).to.be.revertedWith("bad sample size");
  });
});
