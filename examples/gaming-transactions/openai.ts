export type XMTPMessage = {
	messageContent: string;
	memberAddress: string;
}

type Bet = {
  amount: number;
  betCondition: string;
  maker: string;
  taker: string;
};

const SYSTEM_PROMPT = `You are the orchestrator of a prediction market wherein participants place prediction bets on outcomes with other participants. You will be given a group chat history where users are formulating a bet.

Please return all responses as a single function call from the functions you have been provided or "", if there is no appropriate action to be taken for the prediction market from the group chat conversation history.

DO NOT RESPOND AS MARKDOWN and respond with ONLY EITHER ONE OF THE FOLLOWING:
- null, IF THERE IS NO ACTION TO BE IN THE PREDICTION MARKET BASED ON THE MESSAGE HISTORY PROVIDED TO YOU MOST RECENTLY
- culminate your response by making function call that is either create_bet, confirm_bet or resolve_bet

Follow the following instructions on how to operate given the following situations in the prediction market.
1. If users are just conversing and there has been either no proposed bet or requested resolution of an existing confirmed bet. Then return null.
2. If a user ID has propsed a bet and ONLY if it has both a maker and a taker for the bet, call the function create_bet to ask whether to create the bet on the terms discussed between the maker and the taker.
3. If there has been a created bet that is pending confirmation, and both the maker and the taker have confirmed the bet, call the function confirm bet with the betId that is provided when create_bet is called prior and the confirmation of the bet is still pending.
4. If either the maker or taker of a bet call for the resolution of a bet with a certain betId, look for the bet condition (betCondition) associated with that betId. Search the internet to understand whether that bet condition (betCondition) has resolved yet or not. If it has not resolved, you are not required to provide a winner while calling resolve_bet and this is implied that the bet has not resolved yet, however, provide a reason or indication that the bet has not resolved yet as part of the resolution details (resolutionDetails). If the bet condition (betCondition) for that bet has resolved, then call resolve_bet with the betId, the winner and the resolution details (resolutionDetails) for that bet.

You as the orchestrator of the prediction market will not be explicitly named or tagged in messages (DO NOT EXPECT @socialpredmarkets or @0xd44f2f39ca38aa505bbcaed6a5725c63495a8c19 as a cue to expect you to respond) YET you are proactively expected to understand the context from the existing messages and respond without explicit request to you.`

export class OpenAIHandler {

	private OPENAI_API_KEY: string;
	private messages: any[];

	constructor(OPENAI_API_KEY: string) {
		this.OPENAI_API_KEY = OPENAI_API_KEY;
		this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
	}

	public async handleNewChatMessage(
		chatMessageHistory: XTMPMessage[],
		pendingBets: Record<string, Bet>,
		confirmedBets: Record<string, Bet>
	): Promise<object | null>{
		// Add any data about pending bets and confirmed bets into the prompt context as well
		const response = await this.makeOpenAIRequest(`
			--- CONVERSATION HISTORY ---
			${JSON.stringify(
				chatMessageHistory.map((message: XMTPMessage) => ({
					userId: message.memberAddress,
					content: message.messageContent
				}))
			)}
			--- PENDING BETS ---
			${JSON.stringify(Object.entries(pendingBets).map((arr) => ({ betId: arr[0], bet: arr[1]})))}
			--- CONFIRMED BETS ---
			${JSON.stringify(Object.entries(confirmedBets).map((arr) => ({ betId: arr[0], bet: arr[1]})))}
		`)
		if (response.content?.at(0)?.type !== "output_text") {
			return response;
		} else {
			return JSON.parse(response.content[0].text);
		}
	}

	private async makeOpenAIRequest(userMessageContent: string) {
		this.messages.push({ role: "user", content: userMessageContent });
		const response = await fetch("https://api.openai.com/v1/responses", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Authorization: `Bearer ${this.OPENAI_API_KEY}`
			},
			body: JSON.stringify({
				model: "gpt-4.1",
				input: this.messages,
				tools: [
					{ "type": "web_search_preview", "search_context_size": "low" },
					{
						"type": "function",
						name: "create_bet",
						description: "Create a bet between two user IDs that is yet to be resolved. The bet will be resolved later wherein either of the two users involved in the bet call for the resolution of that bet. Each bet has a maker (the user ID who proposes the bet and the amount) and a taker (the user ID who accepts the bet on the terms previously stated by the maker)",
						parameters: {
							"type": "object",
							properties: {
								amount: {
									"type": "number",
									description: "The amount being bet",
								},
								betCondition: {
									"type": "string",
									description: "The condition being bet upon. Attempt to make this a concise description of the bet, yet do not simplify this condition too far as it will be used to resolve the bet and having more detail there is better"
								},
								maker: {
									"type": "string",
									description: "The maker of the bet or the user ID who proposes the condition to bet on (the bet) and the amount to bet for"
								},
								taker: {
									"type": "string",
									description: "The taker of the bet or the user ID that accepts the terms of the bet"
								}
							},
							required: [ "amount", "betCondition", "maker", "taker" ],
							additionalProperties: false,
						}
					}, {
						"type": "function",
						name: "confirm_bet",
						description: "Confirm the bet as placed once both users approve the bet after create_bet has been called on the terms of the bet",
						parameters: {
							"type": "object",
							properties: {
								"betId": {
									"type": "string",
									description: "The ID of the bet that is confirmed by the maker and taker of the bet"
								}
							},
							required: [ "betId" ],
							additionalProperties: false,
						}
					}, {
						"type": "function",
						name: "resolve_bet",
						description: "Provide the resolution to the bet by declaring the user ID who is the winner of the bet",
						parameters: {
							"type": "object",
							properties: {
								"betId": {
									"type": "string",
									description: "The ID of the bet to be resolved"
								},
								"winner": {
									"type": "string",
									description: "The user ID of the winner of the bet based on the resolution you have provided after searching the web for the outcome of the bet condition that the bet was placed upon"
								},
								"resolutionDetails": {
									"type": "string",
									description: "The details about why the resolution of the bet condition is as you have determined by gathering data from the web. Answer conciselly in one to two lines that describes the event, outcome or occurrence that causes the bet to resolve as you have resolved it. If you are unable to provide a clear and appropriate resolution, you are permitted to mention here as to why the resolution has not yet occurred or the bet is unable to be resolved"
								}
							},
							required: [ "betId", "resolutionDetails" ],
							additionalProperties: false
						}
					}
				]
			}),
		});

		if (!response.ok) {
			throw new Error("Unable to connect to external services");
		}

		const responseBody = await response.json();
		return responseBody.output.at(-1);		
	}

}
