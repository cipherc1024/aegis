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

    async function proposerSubmit({ execHash, heartbeat = false }) {
      const n = await ethers.provider.getBlockNumber();
      const block = await ethers.provider.getBlock(n);
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      await registry.connect(tee).submitReceipt(AGENT_ID, ethers.id("pdr"), GUARD, execHash, nonce, n, block.hash, heartbeat);
      return { n, block, nonce };
    }

    async function challengerValidate({ response, signer = challenger }) {
      const digest = await registry.lastReceiptHash(AGENT_ID);
      await validation.connect(signer).validationRequest(signer.address, AGENT_ID, "ipfs://challenge", digest);
      await validation.connect(signer).validationResponse(digest, response, "ipfs://verdict", ethers.ZeroHash, "challenger");
    }

    it("rejects executeTrade when challenger has NOT validated the receipt", async () => {
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data)).to.be.revertedWith(
        "Untrusted challenger"
      );
    });

    it("rejects executeTrade when friendly validator disagrees (response=0)", async () => {
      await vault.connect(owner).setTrustedValidator(challenger.address, true);
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await challengerValidate({ response: 0 });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data)).to.be.revertedWith(
        "No challenger quorum"
      );
    });

    it("executes when trusted challenger agrees (response=100) — mutual verification quorum", async () => {
      await vault.connect(owner).setTrustedValidator(challenger.address, true);
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await challengerValidate({ response: 100 });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data))
        .to.emit(vault, "TradeExecuted")
        .withArgs(await target.getAddress(), amount, eh);
    });

    it("self-attestation cannot forge quorum: untrusted validator's 100 is ignored", async () => {
      const impostor = ethers.Wallet.createRandom().connect(ethers.provider);
      await owner.sendTransaction({ to: impostor.address, value: ethers.parseEther("1") });
      await vault.connect(owner).setTrustedValidator(challenger.address, true);
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      // 攻击者自己背书自己：requestHash 与合法 challenger 相同
      await challengerValidate({ response: 100, signer: impostor });
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data)).to.be.revertedWith(
        "Untrusted challenger"
      );
    });

    it("revoking a validator immediately stops honoring its prior endorsement", async () => {
      await vault.connect(owner).setTrustedValidator(challenger.address, true);
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);
      await proposerSubmit({ execHash: eh });
      await challengerValidate({ response: 100 });
      await vault.connect(owner).setTrustedValidator(challenger.address, false);
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data)).to.be.revertedWith(
        "Untrusted challenger"
      );
    });

    it("validator allowlist is owner-only and rejects a zero address", async () => {
      await expect(
        vault.connect(challenger).setTrustedValidator(challenger.address, true)
      ).to.be.revertedWith("Not owner");
      await expect(vault.connect(owner).setTrustedValidator(ethers.ZeroAddress, true)).to.be.revertedWith(
        "Zero validator"
      );
      await vault.connect(owner).setTrustedValidator(challenger.address, true);
      expect(await vault.isTrustedValidator(challenger.address)).to.equal(true);
      expect(await vault.trustedValidatorCount()).to.equal(1n);
      await expect(vault.connect(owner).setTrustedValidator(challenger.address, true)).to.be.revertedWith("No change");
    });

    // 回归：白名单必须校验地址，但那要求钩子能独立定位"被背书的那张收据"。
    // 若钩子读 lastReceiptHash，心跳收据（challenger 不背书）会顶掉交易收据的 digest，
    // 此用例即 revert "No challenger quorum" —— 心跳之后交易全线作废。
    it("a heartbeat between quorum and execution does not break the gate", async () => {
      await vault.connect(owner).setTrustedValidator(challenger.address, true);
      const amount = ethers.parseEther("0.1");
      const data = target.interface.encodeFunctionData("ping", [42]);
      const eh = execHashOf(await target.getAddress(), amount, data);

      await proposerSubmit({ execHash: eh });
      const tradeDigest = (await registry.lastTradeReceipt(AGENT_ID)).digest;
      const endorsed = await registry.lastReceiptHash(AGENT_ID);
      await challengerValidate({ response: 100 });
      await proposerSubmit({ execHash: ethers.ZeroHash, heartbeat: true });

      // 心跳换了链头，交易槽不动：钩子仍能定位到被 challenger 背书的那张收据。
      // （assert 到链上实际读回值，避免把本地重算的 digest 当作事实）
      const tradeSlot = (await registry.lastTradeReceipt(AGENT_ID)).digest;
      const head = await registry.lastReceiptHash(AGENT_ID);
      const headRec = await registry.latestReceipt(AGENT_ID);
      expect(head).to.not.equal(endorsed);
      expect(tradeSlot).to.equal(tradeDigest);
      // 钩子读取的正是交易槽 digest：链头此刻是心跳，而交易槽仍是那张被背书收据
      expect(headRec.isHeartbeat).to.equal(true);
      expect(headRec.digest).to.not.equal(tradeSlot);
      await expect(vault.connect(tee).executeTrade(await target.getAddress(), amount, data))
        .to.emit(vault, "TradeExecuted")
        .withArgs(await target.getAddress(), amount, eh);
    });
  });

  describe("ValidationRegistry guards", function () {
    let identity, validation, owner, other, third;

    beforeEach(async () => {
      [owner, other, third] = await ethers.getSigners();
      const Identity = await ethers.getContractFactory("IdentityRegistry");
      identity = await Identity.deploy();
      await identity.waitForDeployment();
      const Val = await ethers.getContractFactory("ValidationRegistry");
      validation = await Val.deploy(await identity.getAddress());
      await validation.waitForDeployment();
    });

    const REQ = ethers.id("req-1");

    it("rejects a duplicate requestHash", async () => {
      await validation.connect(other).validationRequest(other.address, AGENT_ID, "ipfs://r", REQ);
      await expect(
        validation.connect(third).validationRequest(third.address, AGENT_ID, "ipfs://r2", REQ)
      ).to.be.revertedWith("exists");
    });

    it("only the registered validator can answer", async () => {
      await validation.connect(other).validationRequest(other.address, AGENT_ID, "ipfs://r", REQ);
      await expect(
        validation.connect(third).validationResponse(REQ, 100, "ipfs://v", ethers.ZeroHash, "t")
      ).to.be.revertedWith("not validator");
    });

    it("rejects response > 100", async () => {
      await validation.connect(other).validationRequest(other.address, AGENT_ID, "ipfs://r", REQ);
      await expect(
        validation.connect(other).validationResponse(REQ, 101, "ipfs://v", ethers.ZeroHash, "t")
      ).to.be.revertedWith("response>100");
    });

    it("getSummary ignores unanswered requests and filters by tag", async () => {
      const REQ2 = ethers.id("req-2");
      await validation.connect(other).validationRequest(other.address, AGENT_ID, "ipfs://r", REQ);
      await validation.connect(third).validationRequest(third.address, AGENT_ID, "ipfs://r", REQ2);
      await validation.connect(other).validationResponse(REQ, 80, "ipfs://v", ethers.ZeroHash, "successRate");
      // REQ2 未应答（lastUpdate == 0）→ 不进统计
      const s1 = await validation.getSummary(AGENT_ID, [other.address, third.address], "successRate");
      expect(s1[0]).to.equal(1n);
      expect(s1[1]).to.equal(80n);
      // tag 不匹配 → 计数 0
      const s2 = await validation.getSummary(AGENT_ID, [other.address, third.address], "otherTag");
      expect(s2[0]).to.equal(0n);
      // 地址列表是过滤器：未列入的验证者不计入
      const s3 = await validation.getSummary(AGENT_ID, [third.address], "successRate");
      expect(s3[0]).to.equal(0n);
    });

    it("tracks per-agent validations and per-validator requests", async () => {
      const REQ2 = ethers.id("req-2");
      await validation.connect(other).validationRequest(other.address, AGENT_ID, "ipfs://r", REQ);
      await validation.connect(other).validationRequest(other.address, AGENT_ID, "ipfs://r", REQ2);
      expect(await validation.getAgentValidations(AGENT_ID)).to.deep.equal([REQ, REQ2]);
      expect(await validation.getValidatorRequests(other.address)).to.deep.equal([REQ, REQ2]);
    });
  });
});
