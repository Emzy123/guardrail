// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function slot0()
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

/// HSKSwap SwapRouter02 (Uniswap V3 style, no deadline field)
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title AgentVault ("Guardrail")
/// @notice Holds the owner's funds for one HSKSwap pool. An AI agent key can trade,
///         but only inside limits the contract enforces: max trade size, daily volume,
///         daily trade count, cooldown, max slippage vs pool price, and a NAV floor
///         (on-chain stop-loss). Owner keeps a kill switch and can withdraw any time.
contract AgentVault {
    // ---- immutable setup ----
    address public immutable owner;
    ISwapRouter02 public immutable router;
    IUniswapV3Pool public immutable pool;
    address public immutable token0;
    address public immutable token1;
    address public immutable quoteToken; // NAV is measured in this token (e.g. USDT)
    uint24 public immutable poolFee;

    // ---- roles & state ----
    address public agent;
    bool public paused;

    struct Limits {
        uint256 maxTradeQuote;   // max size of one trade, in quote-token units
        uint256 dailyVolumeQuote; // max total traded per UTC day, in quote units
        uint16 maxTradesPerDay;
        uint16 maxSlippageBps;   // vs pool spot price
        uint32 cooldownSecs;     // min seconds between trades
        uint256 navFloorQuote;   // trading halts if NAV would fall below this
    }

    Limits public limits;

    uint256 public currentDay;
    uint256 public volumeToday;
    uint16 public tradesToday;
    uint256 public lastTradeAt;

    // ---- events ----
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, uint256 amount, address to);
    event AgentSet(address agent);
    event LimitsSet(Limits limits);
    event Paused(address by, string reason);
    event Unpaused();
    event TradeExecuted(
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 navAfterQuote,
        string rationale
    );

    // ---- errors ----
    error NotOwner();
    error NotAgent();
    error NotAuthorized();
    error IsPaused();
    error BadToken();
    error TradeTooLarge(uint256 sizeQuote, uint256 max);
    error DailyVolumeExceeded();
    error DailyTradesExceeded();
    error Cooldown(uint256 readyAt);
    error SlippageTooHigh(uint16 requestedBps, uint16 maxBps);
    error NavBelowFloor(uint256 nav, uint256 floor);
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _router, address _pool, address _quoteToken, address _agent, Limits memory _limits) {
        owner = msg.sender;
        router = ISwapRouter02(_router);
        pool = IUniswapV3Pool(_pool);
        token0 = pool.token0();
        token1 = pool.token1();
        poolFee = pool.fee();
        if (_quoteToken != token0 && _quoteToken != token1) revert BadToken();
        quoteToken = _quoteToken;
        agent = _agent;
        limits = _limits;
        emit AgentSet(_agent);
        emit LimitsSet(_limits);
    }

    // ================= owner =================

    function setAgent(address _agent) external onlyOwner {
        agent = _agent;
        emit AgentSet(_agent);
    }

    function setLimits(Limits calldata _limits) external onlyOwner {
        limits = _limits;
        emit LimitsSet(_limits);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function withdraw(address token, uint256 amount, address to) external onlyOwner {
        if (!IERC20(token).transfer(to, amount)) revert TransferFailed();
        emit Withdrawn(token, amount, to);
    }

    /// @notice Owner or agent can hit the kill switch. Only the owner can undo it.
    function pause(string calldata reason) external {
        if (msg.sender != owner && msg.sender != agent) revert NotAuthorized();
        paused = true;
        emit Paused(msg.sender, reason);
    }

    // ================= agent =================

    /// @param tokenIn token0 or token1 of the pool
    /// @param amountIn amount of tokenIn to sell
    /// @param slippageBps slippage the agent accepts (must be <= limits.maxSlippageBps)
    /// @param rationale short human-readable reason, logged on-chain for the audit trail
    function trade(address tokenIn, uint256 amountIn, uint16 slippageBps, string calldata rationale)
        external
        returns (uint256 amountOut)
    {
        if (msg.sender != agent) revert NotAgent();
        if (paused) revert IsPaused();
        if (tokenIn != token0 && tokenIn != token1) revert BadToken();
        Limits memory L = limits;
        if (slippageBps > L.maxSlippageBps) revert SlippageTooHigh(slippageBps, L.maxSlippageBps);

        // cooldown
        if (lastTradeAt != 0 && block.timestamp < lastTradeAt + L.cooldownSecs) {
            revert Cooldown(lastTradeAt + L.cooldownSecs);
        }

        // daily counters (UTC day)
        uint256 day = block.timestamp / 1 days;
        if (day != currentDay) {
            currentDay = day;
            volumeToday = 0;
            tradesToday = 0;
        }

        address tokenOut = tokenIn == token0 ? token1 : token0;
        uint256 expectedOut = quote(tokenIn, amountIn);
        uint256 sizeQuote = tokenIn == quoteToken ? amountIn : expectedOut;

        if (sizeQuote > L.maxTradeQuote) revert TradeTooLarge(sizeQuote, L.maxTradeQuote);
        if (volumeToday + sizeQuote > L.dailyVolumeQuote) revert DailyVolumeExceeded();
        if (tradesToday + 1 > L.maxTradesPerDay) revert DailyTradesExceeded();

        uint256 minOut = (expectedOut * (10_000 - slippageBps)) / 10_000;

        IERC20(tokenIn).approve(address(router), amountIn);
        amountOut = router.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );

        // on-chain stop-loss: whole trade reverts if NAV ends below the floor
        uint256 nav = navQuote();
        if (nav < L.navFloorQuote) revert NavBelowFloor(nav, L.navFloorQuote);

        volumeToday += sizeQuote;
        tradesToday += 1;
        lastTradeAt = block.timestamp;

        emit TradeExecuted(tokenIn, amountIn, amountOut, nav, rationale);
    }

    // ================= views =================

    /// @notice Spot-price conversion from the pool's sqrtPriceX96 (fee not included).
    function quote(address tokenIn, uint256 amountIn) public view returns (uint256) {
        (uint160 sqrtP,,,,,,) = pool.slot0();
        uint256 s = uint256(sqrtP);
        if (tokenIn == token0) {
            // price token1 per token0 = s^2 / 2^192
            return (((amountIn * s) >> 96) * s) >> 96;
        } else {
            // token0 per token1 = 2^192 / s^2
            return (((amountIn << 96) / s) << 96) / s;
        }
    }

    /// @notice Vault value in quote-token units at pool spot price.
    function navQuote() public view returns (uint256) {
        address base = quoteToken == token0 ? token1 : token0;
        uint256 q = IERC20(quoteToken).balanceOf(address(this));
        uint256 b = IERC20(base).balanceOf(address(this));
        return q + (b == 0 ? 0 : quote(base, b));
    }

    function status()
        external
        view
        returns (bool isPaused, uint256 nav, uint256 volToday, uint16 tradesCount, uint256 nextTradeAt)
    {
        uint256 day = block.timestamp / 1 days;
        bool sameDay = day == currentDay;
        return (
            paused,
            navQuote(),
            sameDay ? volumeToday : 0,
            sameDay ? tradesToday : 0,
            lastTradeAt == 0 ? 0 : lastTradeAt + limits.cooldownSecs
        );
    }
}
