import "../Registry.sol";

contract EchidnaRegistry {
    Registry registry;

    constructor() {
        registry = new Registry(address(0), address(0), address(0));
    }

    // mutations
    function setDefaultFee(uint256 fee) public {
        registry.setDefaultFeeBps(fee);
    }

    // conditions
    function echidna_defaultFee() public returns (bool) {
        uint256 fee = registry.getFeeBps(address(0));
        return fee >= 0 && fee <= 1000;
    }
}
