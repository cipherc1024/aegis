const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const GUARD = ethers.id("guardrail-v1");
const AGENT_ID = 1n;

describe("Aegis v4 contracts", function () {
  let gov, tee, owner, attacker;
  let registry, vault, policy, target;

  const abi = ethers.AbiCoder.defaultAbiCoder();
  const execHashOf = (targetAddr, amount, data) =>
    ethers.keccak256(abi.encode(["address", "uint256", "bytes"], [targetAddr, amount, data]));

  async function submitReceipt({ execHash, heartbeat = false, signer = tee }) {
    const n = await ethers.provider.getBlockNumber();
    const block = await ethers.provider.getBlock(n);
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    await registry
      .connect(signer)
      .submitReceipt(AGENT_ID, ethers.id("pdr"), GUARD, execHash, nonce, n, block.hash, heartbeat);
    return { n, block, nonce };
  }

  beforeEach(async () => {
    [gov, tee, owner, attacker] = await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockTarget");
    target = await Mock.deploy();
    await target.waitForDeployment();

    const Reg = await ethers.getContractFactory("ReceiptRegistry");
    registry = await Reg.deploy(gov.address);
    await registry.waitForDeployment();

    const Pol = await ethers.getContractFactory("PolicyRegistry");
    policy = await Pol.deploy(gov.address);
    await policy.waitForDeployment();

    await registry.connect(gov).authorizeTEE(AGENT_ID, tee.address);
    await registry.connect(gov).setGuardrailHash(AGENT_ID, GUARD);

    const Vault = await ethers.getContractFactory("AegisVault");
    vault = await Vault.deploy(await registry.getAddress(), AGENT_ID, tee.address, owner.address);
    await vault.waitForDeployment();

    await vault.connect(owner).setTarget(await target.getAddress(), true);
    await vault.connect(owner).setLimits(ethers.parseEther("1"), ethers.parseEther("5"));
    await vault.connect(owner).deposit({ value: ethers.parseEther("10") });
  });

  it("rejects receipt submitted by a non-TEE address", async () => {
    const amount = ethers.parseEther("0.1");
    const data = target.interface.encodeFunctionData("ping", [42]);
    const eh = execHashOf(await target.getAddress(), amount, data);
    await expect(submitReceipt({ execHash: eh, signer: attacker })).to.be.revertedWith(
      "Not authorized TEE"
    );
  });

  it("hash-chains receipts: digest2 commits to digest1", async () => {
    const eh1 = ethers.id("exec-1");
    const eh2 = ethers.id("exec-2");
    await submitReceipt({ execHash: eh1 });
    const d1 = await registry.lastReceiptHash(AGENT_ID);
    const r2 = await submitReceipt({ execHash: eh2 });
    const d2 = await registry.lastReceiptHash(AGENT_ID);

    expect(d2).to.not.equal(d1);
    const expected = await registry.computeDigest(
      AGENT_ID,
      ethers.id("pdr"),
      GUARD,
      eh2,
      r2.n,
      r2.block.hash,
      d1,
      r2.nonce
    );
    expect(d2).to.equal(expected);
  });

  it("executes a whitelisted, PDR-bound trade", async () => {
    const amount = ethers.parseEther("0.1");
    const data = target.interface.encodeFunctionData("ping", [42]);
    const eh = execHashOf(await target.getAddress(), amount, data);
    await submitReceipt({ execHash: eh });
    await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data))
      .to.emit(vault, "TradeExecuted")
      .withArgs(await target.getAddress(), amount, eh);
    expect(await target.calls()).to.equal(1n);
  });

  it("rejects a trade whose calldata is not bound to the receipt", async () => {
    const amount = ethers.parseEther("0.1");
    const data = target.interface.encodeFunctionData("ping", [1]);
    await submitReceipt({ execHash: ethers.id("some-other-exec") });
    await expect(
      vault.connect(tee).executeTrade(await target.getAddress(), amount, data)
    ).to.be.revertedWith("No PDR binding");
  });

  it("rejects a trade when no fresh trade receipt exists", async () => {
    const amount = ethers.parseEther("0.1");
    const data = target.interface.encodeFunctionData("ping", [1]);
    await expect(
      vault.connect(tee).executeTrade(await target.getAddress(), amount, data)
    ).to.be.revertedWith("No fresh trade receipt");
  });

  it("enforces the whitelist", async () => {
    const amount = ethers.parseEther("0.1");
    const data = target.interface.encodeFunctionData("ping", [1]);
    const eh = execHashOf(await target.getAddress(), amount, data);
    await submitReceipt({ execHash: eh });
    await vault.connect(owner).setTarget(await target.getAddress(), false);
    await expect(
      vault.connect(tee).executeTrade(await target.getAddress(), amount, data)
    ).to.be.revertedWith("Target not whitelisted");
  });

  it("enforces the daily limit across multiple trades", async () => {
    await vault.connect(owner).setLimits(ethers.parseEther("0.04"), ethers.parseEther("0.05"));
    const amount = ethers.parseEther("0.04");
    const data = target.interface.encodeFunctionData("ping", [1]);
    const eh = execHashOf(await target.getAddress(), amount, data);

    await submitReceipt({ execHash: eh });
    await vault.connect(tee).executeTrade(await target.getAddress(), amount, data);

    await submitReceipt({ execHash: eh });
    await expect(
      vault.connect(tee).executeTrade(await target.getAddress(), amount, data)
    ).to.be.revertedWith("Exceeds daily limit");
  });

  it("dead-man switch: freezes when stale, resumes only after a fresh receipt", async () => {
    await submitReceipt({ execHash: ethers.id("exec-x") });
    expect(await registry.isAlive(AGENT_ID, 60)).to.equal(true);

    await network.provider.send("hardhat_mine", ["0x50"]); // mine 80 blocks
    expect(await registry.isAlive(AGENT_ID, 60)).to.equal(false);

    await vault.connect(attacker).freezeIfStale();
    expect(await vault.tradingFrozen()).to.equal(true);

    await expect(vault.connect(owner).resumeTrading()).to.be.revertedWith("Agent still stale");

    await submitReceipt({ execHash: ethers.id("exec-x") }); // fresh receipt
    await vault.connect(owner).resumeTrading();
    expect(await vault.tradingFrozen()).to.equal(false);
  });

  it("heartbeat receipt does not clobber the trade binding", async () => {
    const amount = ethers.parseEther("0.1");
    const data = target.interface.encodeFunctionData("ping", [7]);
    const eh = execHashOf(await target.getAddress(), amount, data);

    await submitReceipt({ execHash: eh }); // trade receipt
    await submitReceipt({ execHash: ethers.ZeroHash, heartbeat: true }); // heartbeat

    // latestExecutionHash reads lastTradeReceipt, so the trade is still bound
    await vault.connect(tee).executeTrade(await target.getAddress(), amount, data);
    expect(await target.calls()).to.equal(1n);
  });

  describe("transcript binding (bindTranscript)", () => {
    it("TEE binds a transcript hash to the latest receipt", async () => {
      const eh = ethers.id("exec-t1");
      await submitReceipt({ execHash: eh });
      const digest = await registry.lastReceiptHash(AGENT_ID);
      const tHash = ethers.id("transcript-1");
      await expect(registry.connect(tee).bindTranscript(AGENT_ID, digest, tHash, "ipfs://aegis-transcript"))
        .to.emit(registry, "TranscriptBound")
        .withArgs(AGENT_ID, digest, tHash, "ipfs://aegis-transcript");
      expect(await registry.transcriptHash(digest)).to.equal(tHash);
    });

    it("rejects transcript binding from a non-TEE address", async () => {
      const eh = ethers.id("exec-t2");
      await submitReceipt({ execHash: eh });
      const digest = await registry.lastReceiptHash(AGENT_ID);
      await expect(
        registry.connect(attacker).bindTranscript(AGENT_ID, digest, ethers.id("x"), "uri")
      ).to.be.revertedWith("Not authorized TEE");
    });

    it("rejects binding to a non-latest receipt and rejects double binding", async () => {
      const eh1 = ethers.id("exec-t3");
      await submitReceipt({ execHash: eh1 });
      const oldDigest = await registry.lastReceiptHash(AGENT_ID);
      const eh2 = ethers.id("exec-t4");
      await submitReceipt({ execHash: eh2 }); // chain advances
      await expect(
        registry.connect(tee).bindTranscript(AGENT_ID, oldDigest, ethers.id("x"), "uri")
      ).to.be.revertedWith("Not latest receipt");
      const newDigest = await registry.lastReceiptHash(AGENT_ID);
      await registry.connect(tee).bindTranscript(AGENT_ID, newDigest, ethers.id("y"), "uri");
      await expect(
        registry.connect(tee).bindTranscript(AGENT_ID, newDigest, ethers.id("z"), "uri")
      ).to.be.revertedWith("Transcript bound");
    });
  });

  describe("DCAP quote path (submitReceiptWithQuote)", () => {
    let gate;
    beforeEach(async () => {
      const Mock = await ethers.getContractFactory("MockDcapGate");
      gate = await Mock.deploy();
      await gate.waitForDeployment();
      await registry.connect(gov).setDcapGate(await gate.getAddress());
    });

    async function submitWithQuote({ execHash, signer = attacker }) {
      const n = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(n);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      await registry
        .connect(signer)
        .submitReceiptWithQuote(
          AGENT_ID,
          ethers.id("pdr"),
          GUARD,
          execHash,
          nonce,
          n,
          block.hash,
          false,
          "0x1234"
        );
    }

    it("accepts a quote that is verified AND bound (anyone may submit)", async () => {
      await gate.set(true, true);
      await submitWithQuote({ execHash: ethers.id("exec-q") });
      const r = await registry.lastTradeReceipt(AGENT_ID);
      expect(r.executionHash).to.equal(ethers.id("exec-q"));
    });

    it("rejects when the quote is not verified", async () => {
      await gate.set(false, true);
      await expect(submitWithQuote({ execHash: ethers.id("exec-q") })).to.be.revertedWith(
        "DCAP quote not verified"
      );
    });

    it("rejects when report_data is not bound to the receipt", async () => {
      await gate.set(true, false);
      await expect(submitWithQuote({ execHash: ethers.id("exec-q") })).to.be.revertedWith(
        "DCAP report_data not bound"
      );
    });
  });

  describe("AegisVaultQuorum (proposer/challenger mutual verification)", function () {
    let gov2, tee, owner, challenger;
    let registry, vault, validation, target;

    const abi = ethers.AbiCoder.defaultAbiCoder();
    const execHashOf = (targetAddr, amount, data) =>
      ethers.keccak256(abi.encode(["address", "uint256", "bytes"], [targetAddr, amount, data]));

    beforeEach(async () => {
      [, tee, owner, challenger] = await ethers.getSigners();
      gov2 = (await ethers.getSigners())[0];

      const Mock = await ethers.getContractFactory("MockTarget");
      target = await Mock.deploy();
      await target.waitForDeployment();

      const Reg = await ethers.getContractFactory("ReceiptRegistry");
      registry = await Reg.deploy(gov2.address);
      await registry.waitForDeployment();

      const Identity = await ethers.getContractFactory("IdentityRegistry");
      const identity = await Identity.deploy();
      await identity.waitForDeployment();

      const Val = await ethers.getContractFactory("ValidationRegistry");
      validation = await Val.deploy(await identity.getAddress());
      await validation.waitForDeployment();

      await registry.connect(gov2).authorizeTEE(AGENT_ID, tee.address);
      await registry.connect(gov2).setGuardrailHash(AGENT_ID, GUARD);

      const Vault = await ethers.getContractFactory("AegisVaultQuorum");
      vault = await Vault.deploy(
        await registry.getAddress(),
        AGENT_ID,
        tee.address,
        owner.address,
        await validation.getAddress()
      );
      await vault.waitForDeployment();

      await vault.connect(owner).setTarget(await target.getAddress(), true);
      await vault.connect(owner).setLimits(ethers.parseEther("1"), ethers.parseEther("5"));
      await vault.connect(owner).deposit({ value: ethers.parseEther("10") });
    });

    async function proposerSubmit({ execHash }) {
      const n = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(n);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      await registry.connect(tee).submitReceipt(AGENT_ID, ethers.id("pdr"), GUARD, execHash, nonce, n, block.hash, false);
      return { n, block, nonce };
    }

    async function challengerValidate({ response }) {
      const digest = await registry.lastReceiptHash(AGENT_ID);
      await validation.connect(challenger).validationRequest(challenger.address, AGENT_ID, "ipfs://challenge", digest);
      await validation.connect(challenger).validationResponse(digest, response, "ipfs://verdict", ethers.ZeroHash, "challenger");
    }

    it("rejects executeTrade when challenger has NOT validated the receipt", async () => {
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data)).to.be.revertedWith(
        "No challenger quorum"
      );
    });

    it("rejects executeTrade when challenger disagrees (response=0)", async () => {
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await challengerValidate({ response: 0 });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data)).to.be.revertedWith(
        "No challenger quorum"
      );
    });

    it("executes when challenger agrees (response=100) — mutual verification quorum", async () => {
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await challengerValidate({ response: 100 });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data))
        .to.emit(vault, "TradeExecuted")
        .withArgs(await target.getAddress(), amount, eh);
    });
  });
});
