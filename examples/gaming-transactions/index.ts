import {
  createSigner,
  getEncryptionKeyFromHex,
  logAgentDetails,
  validateEnvironment,
} from "@helpers/client";
import { TransactionReferenceCodec } from "@xmtp/content-type-transaction-reference";
import {
  ContentTypeWalletSendCalls,
  WalletSendCallsCodec,
} from "@xmtp/content-type-wallet-send-calls";
import { Client, type XmtpEnv } from "@xmtp/node-sdk";
import { USDCHandler } from "./usdc";

/* Get the wallet key associated to the public key of
 * the agent and the encryption key for the local db
 * that stores your agent's messages */
const {
  WALLET_KEY,
  ENCRYPTION_KEY,
  XMTP_ENV,
  NETWORK_ID,
  INBOX_ID,
  OPENAI_API_KEY,
} = validateEnvironment([
  "WALLET_KEY",
  "ENCRYPTION_KEY",
  "XMTP_ENV",
  "NETWORK_ID",
  "INBOX_ID",
  "OPENAI_API_KEY",
]);

const SYSTEM_PROMPT = `You are a helpful assistant. You will be given a group chat history where users are formulating a bet.
Please return all responses in JSON. Do not respond in markdown.
Your response should be formatted as 
{
  "amount": { "type": "number" },
  "betCondition": { "type": "string" },
  "maker": { "type": "string" },
  "taker": { "type": "string" }
},
"required": [ "amount", "betCondition", "maker", "taker" ]

IF ANY OF THE NUMBER FIELDS ARE 0 OR ANY OF THE STRING FIELDS ARE EMPTY STRING, AS IN YOU DO NOT HAVE A VALID VALUE FOR THAT FIELD, PLEASE ABSTAIN ATTEMPTING TO MAKE THE JSON RESPONSE AND JUST RETURN null
EVERY BET MUST HAVE BOTH A MAKER AND A TAKER WHO APPROVE IF EITHER IS MISSING RETURN null INSTEAD OF THE JSON RESPONSE
`;
const USER_REQUEST = "Here are the previous user messages in the group chat: ";

const RESOLVE_SYSTEM_PROMPT = `You are a helpful assistant. Given a JSON object representing a bet, determine the winner based on the outcome of the bet condition.

Here is the JSON object format:
- "amount": A number representing the bet value.
- "betCondition": A string defining the condition of the bet.
- "maker": A string with the ID of the bet maker.
- "taker": A string with the ID of the bet taker.

Your task is to find the outcome related to the "betCondition" by using available information, and then decide whether the "maker" or "taker" wins the bet.

# Steps

1. **Analyze the Bet Condition**: Evaluate the betCondition to understand what historical fact or event must be verified.
2. **Determine the Outcome**: 
   - Search for verifiable facts or information related to the betCondition.
   - Determine the factual outcome necessary to assess the bet.
3. **Decide the Winner**:
   - Compare the determined outcome against the betCondition.
   - Based on this comparison, decide which participant (either the maker or taker) has won the bet.
   
# Output Format

Please return all responses in JSON. Do not respond in markdown.
Your response should be formatted as 
{
  "winner": { "type": "string" },
},
"required": [ "winner" ]

# Examples

Example:

**Input**:
json
{
  "amount": 0.01,
  "betCondition": "The Berlin Wall collapsed before 1950.",
  "maker": "0x5b3d1a877a73dbe2ef56e4237a7305d4f7dd095f",
  "taker": "0xc6b2ad1c324aca7aea78307aca74ddc3f6d55c0e"
}

**Search result**: "The Berlin Wall fell on 9 November 1989"

**Response**: 
{"winner": "0xc6b2ad1c324aca7aea78307aca74ddc3f6d55c0e"}

# Notes

- Make sure to analyze the bet condition thoroughly to avoid errors in deciding the winner.
- Only return the ID of the winner in your response with no additional text.
`;

type Bet = {
  amount: number;
  betCondition: string;
  maker: string;
  taker: string;
};

async function main() {
  console.log(WALLET_KEY);
  console.log(ENCRYPTION_KEY);
  console.log(XMTP_ENV);
  console.log(NETWORK_ID);
  console.log(INBOX_ID);

  const usdcHandler = new USDCHandler(NETWORK_ID);
  /* Create the signer using viem and parse the encryption key for the local db */
  const signer = createSigner(WALLET_KEY);
  const dbEncryptionKey = getEncryptionKeyFromHex(ENCRYPTION_KEY);
  /* Initialize the xmtp client */
  const client = await Client.create(signer, {
    dbEncryptionKey,
    env: XMTP_ENV as XmtpEnv,
    codecs: [new WalletSendCallsCodec(), new TransactionReferenceCodec()],
  });

  const identifier = await signer.getIdentifier();
  const agentAddress = identifier.identifier;
  console.log("identifier::::", identifier);
  console.log("agentAddress::::", agentAddress);

  void logAgentDetails(client as Client);

  /* Sync the conversations from the network to update the local db */
  console.log("✓ Syncing conversations...");
  await client.conversations.sync();

  console.log("Waiting for messages...");
  /* Stream all messages from the network */
  const stream = await client.conversations.streamAllMessages();

  let lastSentMessageId = null;
  let seenMessages = new Set();
  let memberAddresses = new Set();
  let userMessages = new Array();
  let lastBet: Bet | null = null;
  let firstMessage = true;


	/*
	let streamedData = stream.next();
	while (!streamedData.done) {
		if (
			!message || !seenMessages.has(message?.id) {
		}
		streamedData = stream.next();
	}
	*/

  for await (const message of stream) {
    if (seenMessages.has(message?.id)) {
      continue;
    }
    /* Ignore messages from the same agent or non-text messages or undefined */
    if (
      message?.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() &&
      message?.contentType?.typeId !== "text"
    ) {
      continue;
    }

    if (message?.senderInboxId === INBOX_ID) {
      continue;
    }

    // determine group members
    console.log(
      `Received message: ${message.content as string} by ${message.senderInboxId}`,
    );

    /* Get the conversation by id */
    const conversation = await client.conversations.getConversationById(
      message.conversationId,
    );

    if (!conversation) {
      console.log("Unable to find conversation, skipping");
      continue;
    }

    if (firstMessage) {
      firstMessage = false;
      lastSentMessageId =
        await conversation.send(`Welcome to Social Prediction Markets:
      
      To place a bet from the conversation: type /createbet
      To see if a certain prediction has resolved: type /resolve`);
      seenMessages.add(lastSentMessageId);
    }

    const inboxState = await client.preferences.inboxStateFromInboxIds([
      message.senderInboxId,
    ]);

    //console.log("inbox state", JSON.stringify(inboxState));

    const memberAddress = inboxState[0].identifiers[0].identifier;

    if (!memberAddress) {
      console.log("Unable to find member address, skipping");
      continue;
    } else {
      console.log("Member address", memberAddress);
      memberAddresses.add(memberAddress);
    }

    const messageContent = message?.content as string;
		if (!messageContent) {
			console.log("Received undefined or null message");
			continue;	
		}
    const command = messageContent.toLowerCase().trim();

    userMessages.push({ messageContent, memberAddress });
    try {
      if (command.startsWith("/createbet")) {
        if (userMessages.length <= 1) {
          lastSentMessageId = await conversation.send(
            "You and your betting taker must add betting context and agree before creating bet.\n",
          );
          seenMessages.add(message?.id);
          seenMessages.add(lastSentMessageId);
          continue;
        }

        // get all the previous messages
        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4.1",
              messages: [
                {
                  role: "system",
                  content: `${SYSTEM_PROMPT}`,
                },
                {
                  role: "user",
                  content: `${USER_REQUEST}: ${JSON.stringify(userMessages.map(({ messageContent, memberAddress }) => ({ userId: memberAddress, content: messageContent })))}`,
                },
              ],
            }),
          },
        );

        if (!response.ok) {
          conversation.send(
            "Failed to prepare bet (OpenAI API did not return Status: OK)",
          );
          continue;
        }

        const responseData = await response.json();
        console.log(responseData.choices[0].message.content);
        const parsedJSON = JSON.parse(responseData.choices[0].message.content);
        if (parsedJSON !== null) {
          conversation
            .send(responseData.choices[0].message.content)
            .then((messageId: string) => {
              seenMessages.add(messageId);
            });
          lastBet = parsedJSON;
          continue;
        } else {
        }
      } else if (command.startsWith("/resolve")) {
        if (lastBet === null) {
          seenMessages.add(
            await conversation.send("No last bet made, nothing to resolve"),
          );
          continue;
        }

        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "gpt-4.1",
            tools: [{ type: "web_search_preview", search_context_size: "low" }],
            input: [
              {
                role: "system",
                content: `${RESOLVE_SYSTEM_PROMPT}`,
              },
              {
                role: "user",
                content: `Bet Data: ${JSON.stringify(lastBet)}`,
              },
            ],
          }),
        });

        if (!response.ok) {
          conversation.send(
            "Failed to prepare bet (OpenAI API did not return Status: OK)",
          );
          continue;
        }

        const responseData = await response.json();
        const winner = JSON.parse(
          responseData.output.at(-1).content[0].text,
        ).winner;
        console.log("GPT determines winner as:", winner);

        console.log("GPT before last bet", lastBet);

        if (winner !== lastBet.maker && winner !== lastBet.taker) {
          conversation
            .send("Unable to determine winner of bet")
            .then((messageId: string) => seenMessages.add(messageId));
          lastBet = null;
        } else {
          conversation
            .send(`Winner: ${winner}`)
            .then((messageId: string) => seenMessages.add(messageId));
          const amountInDecimals = Math.floor(lastBet.amount * Math.pow(10, 6));
          const walletSendCalls = usdcHandler.createUSDCTransferCalls(
            lastBet.maker !== winner ? lastBet.maker : lastBet.taker,
            winner,
            amountInDecimals,
          );
          conversation
            .send(walletSendCalls, ContentTypeWalletSendCalls)
            .then((messageId: string) => seenMessages.add(messageId));
          seenMessages.add(message?.id);
        }
      } else if (command.startsWith("/tx ")) {
        console.log("Replied with wallet sendcall");

        seenMessages.add(message?.id);
        seenMessages.add(lastSentMessageId);
      } else {
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("Error processing command:", errorMessage);
      lastSentMessageId = await conversation.send(
        "Sorry, I encountered an error processing your command.",
      );
      seenMessages.add(message?.id);
      seenMessages.add(lastSentMessageId);
    }
  }
}

main().catch(console.error);
