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
import { OpenAIHandler, type Bet } from "./openai";

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

async function main() {
  console.log(WALLET_KEY);
  console.log(ENCRYPTION_KEY);
  console.log(XMTP_ENV);
  console.log(NETWORK_ID);
  console.log(INBOX_ID);

  const usdcHandler = new USDCHandler(NETWORK_ID);
	const openAIHandler = new OpenAIHandler(OPENAI_API_KEY);
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
	let pendingBets: Record<string, Bet> = {};
	let confirmedBets: Record<string, Bet> = {};

	/*
	let streamedData = stream.next();
	while (!streamedData.done) {
		if (
			!message ||
			!seenMessages.has(message?.id) ||
			message.senderInboxId.toLowerCase() === client.inboxId.toLowerCase() ||
			message.contentType.typeId !== "text" ||
			message.senderInboxId === INBOX_ID
		) {
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
        await conversation.send(`Welcome to Amigos Prediction Markets:\n\n\nYou can chat with friends and place bets. When you and a friend have agreed on the terms of a bet Amigos will automatically suggest confirming the bet.\n\nYou can also resolve bets by asking Amigos in the group chat.`);
      seenMessages.add(lastSentMessageId);
    }

    const inboxState = await client.preferences.inboxStateFromInboxIds([
      message.senderInboxId,
    ]);

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
		seenMessages.add(message?.id);

    userMessages.push({ messageContent, memberAddress });
		openAIHandler.handleNewChatMessage(userMessages, pendingBets, confirmedBets).then(
			async (response: object | null) => {
				if (response !== null) {
					if (response.name === "create_bet") {
						const createBetParams = JSON.parse(response["arguments"]) as Bet;	
						conversation.send(`Would you be interested on placing a bet on ${createBetParams.betCondition}\n\nBet Details:\n- Amount: ${createBetParams.amount}\n- Maker: ${createBetParams.maker}\n- Taker: ${createBetParams.taker}`).then((messageId: string) => seenMessages.add(messageId));
						pendingBets[response["call_id"]] = createBetParams;	
					} else if (response.name === "confirm_bet") {
						const { betId } = JSON.parse(response["arguments"]); 
						if (pendingBets[betId] !== undefined) {
							const bet = pendingBets[betId];
							confirmedBets[betId] = bet;
							delete pendingBets[betId];
							conversation.send(`Confirmed bet with betId ${betId}. Please find the bet details below.\n\nBet Details:\n- Amount: ${bet.amount}\n- Maker: ${bet.maker}\n- Taker: ${bet.taker}`).then((messageId: string) => seenMessages.add(messageId));
						} else {
							conversation.send(`Unable to find a pending bet with betId: ${betId}`).then((messageId: string) => seenMessages.add(messageId));
						}
					} else if (response.name === "resolve_bet") {
						let { betId, winner, resolutionDetails } = JSON.parse(response["arguments"]);
						if (
							confirmedBets[betId] !== undefined
						) {
							const bet = confirmedBets[betId];
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
											content: `Bet Data: ${JSON.stringify(bet)}`,
										},
									],
								}),
							});

							if (!response.ok) {
								conversation.send(
									"Failed to prepare bet (OpenAI API did not return Status: OK)",
								);
							} else {
								const responseData = await response.json();
								console.log(JSON.stringify(responseData));
								const winner = JSON.parse(
									responseData.output.at(-1).content[0].text,
								).winner;
								console.log("GPT determines winner as:", winner);

								console.log("GPT before last bet", bet);

								if (winner !== bet.maker && winner !== bet.taker) {
									conversation
										.send("Unable to determine winner of bet")
										.then((messageId: string) => seenMessages.add(messageId));
								} else {
									conversation
										.send(`Winner: ${winner}`)
										.then((messageId: string) => seenMessages.add(messageId));
									const amountInDecimals = Math.floor(bet.amount * Math.pow(10, 6));
									const walletSendCalls = usdcHandler.createUSDCTransferCalls(
										bet.maker !== winner ? bet.maker : bet.taker,
										winner,
										amountInDecimals,
									);
									conversation
										.send(walletSendCalls, ContentTypeWalletSendCalls)
										.then((messageId: string) => seenMessages.add(messageId));
									seenMessages.add(message?.id);
								}		
							}
							/*
							if (winner !== bet.maker && winner !== bet.taker) {
								conversation.send(`Unable to confirm winner of bet with betId ${betId} due to ${resolutionDetails}`).then((messageId: string) => seenMessages.add(messageId));
							} else {
								conversation.send(`Winner of bet with betId ${betId} is ${winner}.\n\nBet Resolution Details: ${resolutionDetails}`).then((messageId: string) => seenMessages.add(messageId));
								delete confirmedBets[betId];
								const amountInDecimals = Math.floor(bet.amount * Math.pow(10, 6));
								const walletSendCalls = usdcHandler.createUSDCTransferCalls(
									bet.maker !== winner ? bet.maker : bet.taker,
									winner,
									amountInDecimals,
								);
								conversation
									.send(walletSendCalls, ContentTypeWalletSendCalls)
									.then((messageId: string) => seenMessages.add(messageId));
							}
							*/
						} else {
							conversation.send(`Unable to find a confirmed bet with betId: ${betId}`).then((messageId: string) => seenMessages.add(messageId));
						}
					}
				}
			}
		);
		/*
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
		*/
  }
}

main().catch(console.error);
