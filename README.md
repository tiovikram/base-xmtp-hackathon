# XMTP Prediction Market Agent

An intelligent prediction market agent built on the [XMTP](https://docs.xmtp.org/) network that enables users to place bets on real-world outcomes in group chats. The agent automatically orchestrates the betting process, from bet creation to resolution using AI-powered web search.

## Features

- **Automated Bet Creation**: AI detects when users agree on bet terms and automatically creates structured bets
- **Smart Confirmation**: Tracks maker and taker confirmations before finalizing bets
- **AI-Powered Resolution**: Uses web search to verify outcomes and determine winners
- **USDC Transfers**: Automatically transfers winnings using on-chain transactions
- **Group Chat Integration**: Works seamlessly in XMTP group conversations

## How It Works

1. **Chat & Agree**: Users discuss and agree on bet terms in the group chat
2. **Auto-Detection**: The AI agent detects when both a maker and taker have agreed on specific terms
3. **Bet Creation**: Agent prompts users to confirm the structured bet
4. **Confirmation**: Both parties confirm the bet details
5. **Resolution**: When requested, the agent searches the web to determine the outcome
6. **Payout**: Winner automatically receives USDC transfer

## Getting Started

### Requirements

- Node.js v20 or higher
- npm or yarn
- OpenAI API key

### Environment Setup

Create a `.env` file with the following variables:

```bash
WALLET_KEY=           # Private key of the agent's wallet
ENCRYPTION_KEY=       # Encryption key for local database
XMTP_ENV=dev         # Network environment (local, dev, production)
NETWORK_ID=          # Network ID for USDC transfers
INBOX_ID=            # Agent's inbox identifier
OPENAI_API_KEY=      # OpenAI API key for AI processing
```

You can generate random XMTP keys with:

```bash
yarn gen:keys
```

### Installation & Running

```bash
# Clone and setup
git clone <repository-url>
cd xmtp-prediction-market
npm install

# Run the agent
npm run dev
```

## Agent Behavior

The prediction market agent operates autonomously by:

### 1. Monitoring Conversations
- Listens to all group chat messages
- Maintains conversation history for context
- Tracks bet states (pending, confirmed, resolved)

### 2. Bet Creation Process
The agent creates bets when it detects:
- A clear bet condition/outcome to predict
- An agreed-upon amount
- A maker (proposer) and taker (accepter)

Example conversation that triggers bet creation:
```
User A: "I bet $10 that Bitcoin will hit $100k by end of 2025"
User B: "You're on! I'll take that bet"
```

### 3. Bet Confirmation
After creation, both parties must confirm:
- Agent prompts for confirmation with bet details
- Tracks confirmations from both maker and taker
- Moves bet from "pending" to "confirmed" state

### 4. Resolution Process
When users request resolution:
- Agent searches the web for current information about the bet condition
- Uses AI to determine if the condition has been met
- Declares winner based on factual outcomes
- Initiates USDC transfer to winner

## Technical Architecture

### Core Components

**OpenAIHandler**: Manages AI interactions for:
- Parsing conversation context
- Detecting bet opportunities
- Resolving bet outcomes with web search

**USDCHandler**: Handles cryptocurrency transfers:
- Creates transfer calls for bet payouts
- Integrates with XMTP wallet functionality

**Message Processing**: 
- Streams all group messages
- Maintains conversation state
- Prevents duplicate processing

### AI System Prompts

The agent uses sophisticated prompts to:
- Understand betting context from natural conversation
- Extract structured bet data (amount, condition, participants)
- Search and verify real-world outcomes
- Make fair resolution decisions

## Bet Data Structure

```typescript
type Bet = {
  amount: number;        // Bet amount in USDC
  betCondition: string;  // What is being predicted
  maker: string;         // Address of bet proposer
  taker: string;         // Address of bet accepter
}
```

## Network Configuration

- **Development**: Uses XMTP's hosted dev network
- **Production**: Uses XMTP's production network  
- **Local**: Run your own XMTP network with Docker

## Security & Privacy

- **End-to-end encryption**: All messages encrypted in transit and at rest
- **Decentralized**: No single point of failure
- **Private keys**: Agent wallet key never shared
- **Autonomous operation**: Minimal human intervention required

## Example Workflow

1. Users join group chat with prediction market agent
2. Agent sends welcome message explaining functionality
3. Users discuss potential bet: "Will it rain tomorrow?"
4. Agent detects agreement and prompts bet creation
5. Both users confirm bet terms
6. Next day, user asks agent to resolve the bet
7. Agent searches weather data and determines outcome
8. Winner receives automatic USDC transfer

## Why XMTP?

- **Compliance**: Meets security and regulatory standards
- **Open Source**: Built on MLS protocol with cryptographic proofs
- **Privacy**: Anonymous/pseudonymous usage options
- **Multi-agent**: Supports confidential group communications
- **Decentralized**: Peer-to-peer network resilience
