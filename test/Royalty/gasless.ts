import { ethers } from "hardhat";
import { expect, use } from "chai";
import { solidity } from "ethereum-waffle";

// Types
import { Forwarder, ProtocolControl, Registry, Royalty } from "typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

// Helpers
import { getContracts } from "../../utils/tests/getContracts";
import { sendGaslessTx } from "../../utils/tests/gasless";
import { BigNumber } from "ethers";

use(solidity);

describe("Test royalty functionality: gasless transactions", function() {

  const FACTOR: number = 10_000;

  // Signers
  let relayer: SignerWithAddress;
  let protocolProvider: SignerWithAddress;
  let royalty_admin: SignerWithAddress;
  let shareHolder_1: SignerWithAddress;
  let shareHolder_2: SignerWithAddress;
  let registryFeeRecipient: SignerWithAddress;

  // Contracts
  let forwarder: Forwarder;
  let registry: Registry;
  let controlCenter: ProtocolControl;
  let royaltyContract: Royalty;
  let proxyForRoyalty: Royalty;

  // Initialization params
  let uri: string;
  let payees: SignerWithAddress[];
  let shares: number[];

  function scaleShares(_shares: number[]): number[] {
    return _shares.map(val => val * 10_000);
  }

  before(async () => {
    // Get signers
    [
      protocolProvider,
      royalty_admin,
      shareHolder_1,
      shareHolder_2,
      registryFeeRecipient,
      relayer,
    ] = await ethers.getSigners();

    // Get initialize params
    const contracts = await getContracts(protocolProvider, royalty_admin);
    forwarder = contracts.forwarder;
    registry = contracts.registry;
    controlCenter = contracts.protocolControl;
    uri = "ipfs://"
    payees = [royalty_admin, shareHolder_1, shareHolder_2]
    shares = [2000, 4000, 4000];

    // Deploy Royalty implementation
    royaltyContract = await ethers.getContractFactory("Royalty").then(f => f.deploy());
  })
  describe("Test: Royalty contract functionality", function() {

    beforeEach(async () => {
      const thirdwebProxy = await ethers.getContractFactory("ThirdwebProxy")
        .then(f => f.connect(royalty_admin).deploy(
          royaltyContract.address,
          royaltyContract.interface.encodeFunctionData(
            "initialize",
            [
              controlCenter.address,
              forwarder.address,
              uri,
              payees.map(signer => signer.address),
              shares
            ]
          )
        )
      );
  
      proxyForRoyalty = await ethers.getContractAt("Royalty", thirdwebProxy.address) as Royalty;
  
      // Send 100 ether to contract
      await protocolProvider.sendTransaction({
        to: proxyForRoyalty.address,
        value: ethers.utils.parseEther("100")
      });
    })

    
    it("Should be initialized with the right shares for respective shareholders", async () => {
      for(let i = 0; i < payees.length; i += 1) {
        expect(await proxyForRoyalty.shares(payees[i].address)).to.equal(scaleShares(shares)[i]);
      }
    })

    it("Should release the appropriate share of the contract balance to shareholders", async () => {
      const totalMoneyInContract: BigNumber = await ethers.provider.getBalance(proxyForRoyalty.address);
      const totalSharesScaled = shares.reduce((a,b) => a+b) * FACTOR;

      for(let i = 0; i < payees.length; i += 1) {
        const shareholderShares = await proxyForRoyalty.shares(payees[i].address)

        const shareholderPayout = (totalMoneyInContract.mul(shareholderShares)).div(totalSharesScaled)

        const shareholderBalBefore: BigNumber = await ethers.provider.getBalance(payees[i].address);
        await sendGaslessTx(
          protocolProvider,
          forwarder,
          relayer,
          {
            from: protocolProvider.address,
            to: proxyForRoyalty.address,
            data: proxyForRoyalty.interface.encodeFunctionData("release", [payees[i].address])
          }
        );
        const shareholderBalAfter: BigNumber = await ethers.provider.getBalance(payees[i].address);

        expect(shareholderBalAfter).to.equal(shareholderBalBefore.add(shareholderPayout));
      }
    });

    it("Should revert if the a non-shareholder tries to release money from the contract", async () => {
      const non_shareholder = protocolProvider;

      await expect(
        sendGaslessTx(
          protocolProvider,
          forwarder,
          relayer,
          {
            from: protocolProvider.address,
            to: proxyForRoyalty.address,
            data: proxyForRoyalty.interface.encodeFunctionData("release", [non_shareholder.address])
          }
        )
      ).to.be.revertedWith("aymentSplitter: account has no shares")
    });

    it("Should revert if a shareholder is not due any payement", async () => {
      const payee = payees[0];
      
      await sendGaslessTx(
        protocolProvider,
        forwarder,
        relayer,
        {
          from: protocolProvider.address,
          to: proxyForRoyalty.address,
          data: proxyForRoyalty.interface.encodeFunctionData("release", [payee.address])
        }
      )

      await expect(
        sendGaslessTx(
          protocolProvider,
          forwarder,
          relayer,
          {
            from: protocolProvider.address,
            to: proxyForRoyalty.address,
            data: proxyForRoyalty.interface.encodeFunctionData("release", [payee.address])
          }
        )
      ).to.be.revertedWith("PaymentSplitter: account is not due payment")
    });
  })
})