// Random topic generator:
// https://capitalizemytitle.com/random-topic-generator/

// Google Cloud Gemini/Vertex AI info:
// https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference

"use strict";

require("smbdefs.js", "MSG_DELETE");
require("userdefs.js", "USER_NETMAIL");
require("http.js", "HTTPRequest");
require("dd_lightbar_menu.js", "substrWithAttrCodes"); // Only for substrWithAttrCodes()


//////////
// A hack to get substrWithAttrCodes() to work, since the console object doesn't exist
// when running with jsexec
var console = {
	strlen: function(pStr) {
		return strip_ctrl(pStr).length;
	}
};
//////////

var parseArgsRetObj = parseArgs(argv);
if (!file_exists(parseArgsRetObj.cfgFilename))
{
	log(LOG_ERR, "Specified configuration file does not exist: " + parseArgsRetObj.cfgFilename);
	exit(1);
}


log(LOG_INFO, "Reading configuration file: " + parseArgsRetObj.cfgFilename);
var gSettings = readConfigurationFile(parseArgsRetObj.cfgFilename);
if (!gSettings.fileSuccess)
{
	log(LOG_ERR, "Failed to read the configuration file: " + parseArgsRetObj.cfgFilename);
	exit(2);
}
// Verify the sub-board codes
if (gSettings.subCodes.length == 0)
{
	log(LOG_ERR, "No sub-board codes are configured");
	exit(4);
}
/*
if (!verifyConfiguredSubBoardCodes(gSettings))
	exit(4);
*/


var cfgSettingLogLevel = LOG_DEBUG;
//logObject(pLogLevel, pLogLabel, pObj, pNumSpaces)
logObject(cfgSettingLogLevel, "Configuration settings:", gSettings);





log(LOG_INFO, "Will include messages since " + strftime("%Y-%m-%d %H:%M:%S", gSettings.msgIncludeTime));

// TODO: Make gQuotePrefix a setting?
var gQuotePrefix = "> ";

// Read the list of conversation end phrases
var gConversationEndPhrases = readFileIntoArray(gSettings.conversationEndPhraseFilename, true);

// An array to use for topic objects
var gTopicObjs = [];

// An array to use for additional text to add to the AI bot requests
var gAdditionalTextLines = [];

// An array to use for words & phrases to look for in messages
var gWordsAndPhrasesToLookFor = [];


// Create the saved projress object, and load it from file if the file exists
var gSavedProgressObj;
if (file_exists(gSettings.savedProgressFilename))
{
	gSavedProgressObj = readSavedProgressJSON(gSettings.savedProgressFilename);
	if (gSavedProgressObj == {})
	{
		log(LOG_ERR, "Couldn't read" + gSettings.savedProgressFilename);
		exit(5);
	}
}
else
	gSavedProgressObj = {};


var gBotNameUpper = gSettings.botName.toUpperCase();

// If the dictionary of words & phrases to look for is set and exists, then read it
// and populate gWordsAndPhrasesToLookFor
if (gSettings.dictionaryFilenameForWordsAndPhrasesToLookFor != "" && file_exists(gSettings.dictionaryFilenameForWordsAndPhrasesToLookFor))
{
	var inFile = new File(gSettings.dictionaryFilenameForWordsAndPhrasesToLookFor);
	if (inFile.open("r"))
	{
		gWordsAndPhrasesToLookFor = inFile.readAll(4096);
		inFile.close();
		// Convert all to upper-case for case-insensitive matching
		for (var i = 0; i < gWordsAndPhrasesToLookFor.length; ++i)
			gWordsAndPhrasesToLookFor[i] = gWordsAndPhrasesToLookFor[i].toUpperCase();
	}
}


// Go through the sub-boards and do the thing
for (var i = 0; i < gSettings.subCodes.length; ++i)
{
	var subCode = gSettings.subCodes[i];
	if (subCode != "mail" && typeof(msg_area.sub[subCode]) !== "object")
	{
		log(LOG_ERR, "** The sub-board code " + subCode + " is invalid!");
		continue;
	}

	var grpAndSubName = "";
	if (subCode == "mail")
		grpAndSubName = "Mail";
	else
	{
		//grpAndSubName = msg_area.sub[subCode].name + " - " + msg_area.sub[subCode].description;
		//grpAndSubName = msg_area.grp_list[msg_area.sub[subCode].grp_index].name + " - " + msg_area.sub[subCode].description;
		grpAndSubName = msg_area.grp_list[msg_area.sub[subCode].grp_index].name + " - " + msg_area.sub[subCode].name;
	}
	var msgbase = new MsgBase(subCode);
	if (msgbase.open())
	{
		log(LOG_INFO, "Processing " + grpAndSubName);

		if (!gSavedProgressObj.hasOwnProperty(subCode))
			gSavedProgressObj[subCode] = {};

		var msgHdrs = msgbase.get_all_msg_headers(false, false);
		for (var msgNumProp in msgHdrs)
		{
			// If the message has been marked for deletion, then skip it.
			if (Boolean(msgHdrs[msgNumProp].attr & MSG_DELETE))
				continue;
			// To be safe, skip any messages posted by this bot
			if (msgHdrs[msgNumProp].from == gSettings.botName)
				continue;

			var msgHdr = msgHdrs[msgNumProp];

			// Skip messages earlier than the earliest allowed message date/time
			var msgTime = msgWrittenTimeToLocalBBSTime(msgHdr);
			//log(LOG_DEBUG, format("%s - msg# %d, time: %s", grpAndSubName, msgNumProp, strftime("%Y-%m-%d %H:%M:%S", msgTime)));
			if (msgTime < gSettings.msgIncludeTime)
				continue;
				
			// If the 'from' name is in fromNamesToIgnore (upper-cased), then
			// skip it
			var msgFromUpper = "";
			if (typeof(msgHdr.from) === "string")
				msgFromUpper = msgHdr.from.toUpperCase();
			if (msgFromUpper.length > 0 && gSettings.fromNamesToIgnore.indexOf(msgFromUpper) > -1)
				continue;

			// If we've responded to this message already, then skip it
			if (gSavedProgressObj[subCode].hasOwnProperty(msgHdr.number))
				continue;

			// Depending on settings, if the current message is addressed to
			// "All", the bot name, or other names, then get an AI chat
			// response and post a reply to the message.
			var originalMsgIsFromBot = false;
			var msgToUpper = "";
			if (typeof(msgHdr.to) === "string")
				msgToUpper = msgHdr.to.toUpperCase();

			//if (msgToUpper == "ALL" || msgToUpper == gBotNameUpper)

			var replyToThisMsg = false;
			var toCriteriaIsSatisfied = true; // Whether or not the 'to' criteria is satisfied
			if (gSettings.lookForMsgsToAll)
			{
				if (msgToUpper == "ALL")
					replyToThisMsg = true;
				else
					toCriteriaIsSatisfied = false;
			}
			if (!replyToThisMsg && gSettings.lookForMsgsToBot)
			{
				if (msgToUpper == gBotNameUpper || msgToUpper.indexOf(format("%s@%s", gBotNameUpper, system.inet_addr.toUpperCase())) > -1)
				{
					replyToThisMsg = true;
					originalMsgIsFromBot = true;
				}
				else
					toCriteriaIsSatisfied = false;
			}
			var foundBotNameInMsgBody = false;
			var msgBody = "";
			var msgBodyUpper = "";
			if (!replyToThisMsg && gSettings.lookInMsgBodyForBot)
			{
				if (msgBody.length == 0)
				{
					//msgBody = msgbase.get_msg_body(false, msgHdr.number);
					msgBody = msgbase.get_msg_body(false, msgHdr);
					if (typeof(msgBody) !== "string" || msgBody.length == 0)
						continue;
					msgBodyUpper = msgBody.toUpperCase();
				}
				if (msgBodyUpper.indexOf(gBotNameUpper) > -1)
				{
					replyToThisMsg = true;
					foundBotNameInMsgBody = true;
				}
			}
			if (!replyToThisMsg && gSettings.otherNamesToLookFor.length > 0)
			{
				for (var i = 0; i < gSettings.otherNamesToLookFor.length && !replyToThisMsg; ++i)
				{
					replyToThisMsg = (msgToUpper == gSettings.otherNamesToLookFor[i] || msgFromUpper == gSettings.otherNamesToLookFor[i]);
					// If the 'from' name matches, assume it's from a bot.
					// TODO: Will this always be an accurate assumption?
					if (msgFromUpper == gSettings.otherNamesToLookFor[i])
						originalMsgIsFromBot = true;
				}
				if (!replyToThisMsg)
					toCriteriaIsSatisfied = false;
			}
			var subjectCriteriaIsSatisfied = true;
			if (gSettings.subjectsToLookFor.length > 0)
			{
				var msgSubjUpper = msgHdr.subject.toUpperCase();
				if (msgHdr.hasOwnProperty("subject") && msgHdr.subject.length > 0)
				{
					var subjectMatches = false;
					for (var i = 0; i < gSettings.subjectsToLookFor.length && !subjectMatches; ++i)
					{
						var searchSubjUpper = gSettings.subjectsToLookFor[i].toUpperCase();
						subjectMatches = (msgSubjUpper.indexOf(searchSubjUpper) == 0);
					}
					if (toCriteriaIsSatisfied)
						replyToThisMsg = replyToThisMsg && subjectMatches;
					subjectCriteriaIsSatisfied = subjectMatches;
				}
				else // Message has no subject, but there's a subject for us to look for
				{
					replyToThisMsg = false;
					subjectCriteriaIsSatisfied = false;
				}
			}
			// Look for any words and phrases in gWordsAndPhrasesToLookFor, except
			// if the bot name has been seen in the message body (we'll reply in that
			// case regardless).
			if (gWordsAndPhrasesToLookFor.length > 0 && !foundBotNameInMsgBody)
			{
				if (msgBody.length == 0)
				{
					//msgBody = msgbase.get_msg_body(false, msgHdr.number);
					msgBody = msgbase.get_msg_body(false, msgHdr);
					if (typeof(msgBody) !== "string" || msgBody.length == 0)
						continue;

					msgBodyUpper = msgBody.toUpperCase();
				}

				// Split the message body into sections (quoted and not quoted) and
				// search the non-quoted parts of the message body for the words to
				// look for
				var foundDictionaryTerm = false;
				var dictionaryTermFound = "";
				//var msgLines = msgBody.split("\r\n");
				var msgLinesUpper = msgBody.toUpperCase().split("\r\n");
				var msgSections = getMsgSections(msgLinesUpper);
				for (var secI = 0; secI < msgSections.length && !foundDictionaryTerm; ++secI)
				{
					// Skip sections that have a prefix, as those sections are quoted.
					if (msgSections[secI].linePrefix.length > 0)
						continue;

					for (var lineI = msgSections[secI].begLineIdx; lineI <= msgSections[secI].endLineIdx && !foundDictionaryTerm; ++lineI)
					{
						// Go through the dictionary and see if we find a dictionary term in the message body
						for (var dictI = 0; dictI < gWordsAndPhrasesToLookFor.length && !foundDictionaryTerm; ++dictI)
						{
							var dictionaryTerm = gWordsAndPhrasesToLookFor[dictI];
							// Some terms in the dictionary can have a * afterward, which means to allow
							// anything after the term
							var allowAnythingAfter = false;
							if (dictionaryTerm[dictionaryTerm.length-1] == "*")
							{
								dictionaryTerm = dictionaryTerm.substr(0, dictionaryTerm.length-1);
								allowAnythingAfter = true;
							}

							// See if there's anything before or after the word
							var wordStartIdx = msgLinesUpper[lineI].indexOf(dictionaryTerm);
							var nothingBeforeWord = true;
							if (wordStartIdx > 0)
							{
								//nothingBeforeWord = (msgLinesUpper[lineI][wordStartIdx-1] == " ");
								nothingBeforeWord = /[ .,'\/#!$%\^&\*;:{}=\-_`~()]/.test(msgLinesUpper[lineI][wordStartIdx-1]);
							}
							var nothingAfterWord = true;
							if (wordStartIdx + dictionaryTerm.length < msgLinesUpper[lineI].length)
							{
								// After the word, consider punctuation or a space; also consider an 's'
								// afterward for plurals.
								nothingAfterWord = /[ s.,'\/#!$%\^&\*;:{}=\-_`~()]/.test(msgLinesUpper[lineI][wordStartIdx + dictionaryTerm.length]);
							}
							// See if the term can be considered a match
							if (wordStartIdx > -1 && nothingBeforeWord)
							{
								if (allowAnythingAfter)
								{
									if (dictionaryTerm.length > 0)
									{
										foundDictionaryTerm = true;
										dictionaryTermFound = dictionaryTerm;
									}
									else
									{
										foundDictionaryTerm = false;
										dictionaryTermFound = "";
									}
								}
								else
								{
									foundDictionaryTerm = nothingAfterWord;
									if (foundDictionaryTerm && dictionaryTerm.length > 0)
										dictionaryTermFound = dictionaryTerm;
									else
									{
										foundDictionaryTerm = false;
										dictionaryTermFound = "";
									}
								}
							}
						}
					}
				}

				var logMsg = format("%s, %s, %s - Found dictionary term: %s", msgHdr.from, msgHdr.to, msgHdr.subject, foundDictionaryTerm ? "true" : "false");
				if (foundDictionaryTerm)
					logMsg += format(" (%s)", dictionaryTermFound);
				log(LOG_INFO, logMsg);
				// Determine whether to reply to this message based on whether we
				// should use 'and' logic (or 'or' logic) with the from name and subject
				if (foundDictionaryTerm)
				{
					if (gSettings.useDictionaryAndFromAndSubject)
						replyToThisMsg = toCriteriaIsSatisfied && subjectCriteriaIsSatisfied;
					else // Use 'or' logic
						replyToThisMsg = true;
				}
			}

			// Final check for whether the message was posted by a bot - See if it was posted by
			// a user on this BBS.
			if (typeof(msgHdr.from) === "string")
			{
				if (system.matchuser(msgHdr.from) > 0)
					originalMsgIsFromBot = false;
			}
			// If we should reply (so far), then reply to the message
			if (replyToThisMsg)
			{
				if (msgBody.length == 0)
				{
					//msgBody = msgbase.get_msg_body(false, msgHdr.number);
					msgBody = msgbase.get_msg_body(false, msgHdr);
					if (typeof(msgBody) !== "string" || msgBody.length == 0)
						continue;
					msgBodyUpper = msgBody.toUpperCase();
				}

				log(LOG_INFO, format("Processing a message in %s from %s, re: %s", grpAndSubName, msgHdr.from, msgHdr.subject));

				// See if there are any key phrases at the end of the message to signify
				// we should not reply anymore
				var foundEndPhrase = false;
				if (gConversationEndPhrases.length > 0)
				{
					// See where the last quote string ("> ", or gQuotePrefix) is, if any
					var pharseSearchStartIdx = msgBody.lastIndexOf(gQuotePrefix);
					if (pharseSearchStartIdx == -1)
						pharseSearchStartIdx = 0;
					for (var i = 0; i < gConversationEndPhrases.length && !foundEndPhrase; ++i)
					{
						var phraseIdx = msgBodyUpper.lastIndexOf(gConversationEndPhrases[i].toUpperCase());
						if (phraseIdx >= pharseSearchStartIdx)
						{
							foundEndPhrase = true;
							var logMsg = format("Found end phrase in message from %s to %s with subject \"%s\", so not replying: \"%s\"",
							                    msgHdr.from, msgHdr.to, msgHdr.subject, gConversationEndPhrases[i]);
							log(LOG_INFO, logMsg);
							break;
						}
					}

					/*
					// If we found an end phrase, then skip this message
					if (foundEndPhrase)
					{
						continue;
					}
					*/
				}

				// If gAdditionalTextLines hasn't been populated, then populate it
				if (gAdditionalTextLines.length == 0 && gSettings.additionalTextFilename.length > 0)
					gAdditionalTextLines = readFileIntoArray(gSettings.additionalTextFilename, false);

				// Send the message text to Google Gemini and get a respones
				var textToSend = "";
				if (typeof(msgHdr.from) === "string" && msgHdr.from.length > 0)
					textToSend = "From: " + msgHdr.from + "\r\n";
				if (typeof(msgHdr.to) === "string" && msgHdr.to.length > 0)
					textToSend = "To: " + msgHdr.to + "\r\n";
				if (typeof(msgHdr.subject) === "string" && msgHdr.subject.length > 0)
					textToSend = "Re: " + msgHdr.subject + "\r\n\r\n";
				textToSend += msgBody;
				var responseObj = getChatResponse(gSettings, textToSend, originalMsgIsFromBot, gAdditionalTextLines, msgHdr);
				// If we didn't get a valid response and we're using OpenAI, then try again with Google Gemini.
				// For instance, maybe the paid credits for OpenAI ran out.
				if (!responseObj.gotValidResponse && gSettings.AIBackend == "OPENAI")
				{
					log(LOG_INFO, "Failed to get a response from OpenAI; trying with Google Gemini...");
					var settingsBackup = gSettings;
					gSettings.AIBackend = "GOOGLE_GEMINI";
					responseObj = getChatResponse(gSettings, textToSend, originalMsgIsFromBot, gAdditionalTextLines, msgHdr);
					gSettings = settingsBackup;
				}
				// If we got a valid response, then use it to post a message
				if (responseObj.gotValidResponse)
				{
					var responseText = responseObj.responseText;
					// Find the longest line length (to use for message quoting)
					var longestMsgLine = 0;
					var msgBodyLines = lfexpand(msgBody).split("\r\n");
					if (Array.isArray(msgBodyLines))
					{
						for (var i = 0; i < msgBodyLines.length; ++i)
						{
							if (msgBodyLines[i].length > longestMsgLine)
								longestMsgLine = msgBodyLines[i].length;
						}
					}
					// Start building the reply message
					//var replyMsg = format("From: %s\r\n", gSettings.botName);
					var replyMsg = "";

					// If we found an end-of-message phrase, then
					// choose some text for another topic and append
					// text to the message for that subject
					var setThreadBack = false;
					var signBotName = true;
					var msgSubject = "";
					if (foundEndPhrase)
					{
						if (gTopicObjs.length == 0)
							gTopicObjs = readTopicsFile(gSettings.topicsFilename);
						if (gTopicObjs.length > 0)
						{
							log(LOG_INFO, format("Choosing a new topic out of %d available topics", gTopicObjs.length));
							setThreadBack = false;
							//subject: fileArray[i],
							//msgText: fileArray[i+1]
							//dirName = dirs[random(dirs.length)];
							var topicObj = gTopicObjs[random(gTopicObjs.length)];
							msgSubject = topicObj.subject;
							replyMsg += format("Re: %s\r\n\r\n", msgSubject);
							if (typeof(msgHdr.subject) === "string" && msgHdr.subject.length > 0)
								replyMsg += format("It was good talking about \"%s\".\r\n", msgHdr.subject);
							replyMsg += "On another note, what do you think about this: " + topicObj.msgText;
						}
						else
							continue; // Skip this message
					}
					else
					{
						// Didn't find an end-of-message phrase
						setThreadBack = true;
						msgSubject = msgHdr.subject;
						replyMsg += format("Re: %s\r\n\r\n", msgSubject);
						//replyMsg += quote_msg(msgBody);
						//replyMsg += quote_msg(msgBody, 79, gQuotePrefix);
						replyMsg += quote_msg(msgBody, longestMsgLine, gQuotePrefix);
						replyMsg += "\r\n\r\n";
						var replyTextArray = responseText.split("\n");
						for (var i = 0; i < replyTextArray.length; ++i)
							replyMsg += format("%s\r\n", replyTextArray[i]);

						signBotName = (responseText.lastIndexOf("\n" + gSettings.botName) < 0) && (responseText.lastIndexOf("\n" + msgHdr.from) < 0);
					}

					// TODO: Fix this - Sometimes the response message has a signed name
					// Sign the bot's name if we haven't seen it signed in the response already
					if (signBotName)
					{
						replyMsg += "\r\n\r\n" + gSettings.botName;
					}

					// Create the message header, and send the message.
					var newMsgHeader = {
						to: msgHdr.from,
						//from_net_type: NET_NONE,
						//to_net_type: NET_NONE,
						from: gSettings.botName,
						//subject: msgHdr.subject,
						subject: msgSubject,
						editor: "FSEditor.js v1.105",
						from_ip_addr: "127.0.0.1",
						from_host_name: "localhost",
						from_protocol: "SSH"
					};
					// If posting in private email, then add some more properties to the message header
					if (subCode == "mail")
					{
						newMsgHeader.from_net_type = NET_NONE;
						newMsgHeader.to_net_type = NET_NONE; // Default
						setThreadBack = true;
						if (typeof(msgHdr.from) === "string")
						{
							var toUserNum = system.matchuser(msgHdr.from);
							if (toUserNum > 0)
							{
								newMsgHeader.to_ext = toUserNum;
								// If the message came from email, then send via email
								var destUser = new User(toUserNum);
								if (Boolean(destUser.settings & USER_NETMAIL))
								{
									newMsgHeader.to_net_type = netaddr_type(destUser.netmail);
									if (newMsgHeader.to_net_type != NET_NONE)
										newMsgHeader.to_net_addr = destUser.netmail;
									else
									{
										log(LOG_ERROR, format("Can't send email reply to %s", msgHdr.from));
										continue;
									}
									var botUserNum = system.matchuser(gSettings.botName);
									if (botUserNum > 0)
									{
										var fromUser = new User(botUserNum);
										newMsgHeader.from_net_addr = fromUser.netmail;
										newMsgHeader.editor = fromUser.editor;
									}
									else
										newMsgHeader.from_net_addr = "sysop@" + system.inet_addr;
								}
							}
							var fromUserNum = system.matchuser(gSettings.botName);
							if (fromUserNum > 0)
							{
								newMsgHeader.from_ext = fromUserNum;
								newMsgHeader.sender_userid = gSettings.botName;
							}
							else if (msgHdr.hasOwnProperty("from_net_addr"))
							{
								newMsgHeader.to_net_type = netaddr_type(msgHdr.from_net_addr);
								newMsgHeader.to = msgHdr.from + " <" + msgHdr.from_net_addr + ">";
							}
						}
					}
					if (setThreadBack)
						newMsgHeader.thread_back = msgHdr.number;
					if (msgbase.save_msg(newMsgHeader, replyMsg))
					{
						// We successfully saved the message.
						log(LOG_INFO, format("Replied as %s to a message in %s from %s, re: %s", gSettings.botName, grpAndSubName, msgHdr.from, msgHdr.subject));
						// Add this message to the progress record to show that we've
						// replied to this message already
						gSavedProgressObj[subCode][msgHdr.number] = {
							processTime: time()
						};
					}
					else
					{
						log(LOG_ERROR, format("* Failed to save message, replying as %s to a message in %s from %s, re: %s",
						                      gSettings.botName, grpAndSubName, msgHdr.from, msgHdr.subject));
					}
				}
				else
					log(LOG_ERROR, "* Did not get a valid response from the AI chat back-end!");
			}
		}

		msgbase.close();

		// Clean up: If there are any message numbers in gSavedProgressObj for this sub-board that aren't
		// in the sub-board anymore, then remove it from gSavedProgressObj for this sub-board.
		for (var msgNum in gSavedProgressObj[subCode])
		{
			if (!msgHdrs.hasOwnProperty(msgNum))
				delete gSavedProgressObj[subCode][msgNum];
		}
	}
	else
		log(LOG_ERR, format("* Failed to open sub-board %s (%s)", subCode, grpAndSubName));
}



// Done
// Save the status to the JSON file
var outFile = new File(gSettings.savedProgressFilename);
if (outFile.open("w"))
{
	outFile.write(JSON.stringify(gSavedProgressObj));
	outFile.close();
	log(LOG_INFO, "Saved progress to " + file_getname(gSettings.savedProgressFilename));
}
else
	log(LOG_ERR, "Failed to save JSON to " + gSettings.savedProgressFilename);
log(LOG_INFO, "Done.");

//////////////////////////////////////////////////////
// Functions

// Parses command-line arguments.  Returns an object with the specified options.
//
// Parameters:
//  pArgv: The array of arguments to this script
//
// Return value: An object with the following properties:
//               wordCategory: The category of words we're looking for (defaults to Vulgarity)
//               wordDescription: A description of the words (defaults to Vulgar)
//               grpName: The name of a message group to process
//               subCode: The internal code of a sub-board to process.  Takes precedence over grpName if not empty.
//               fromName: The name of a user whose messages to process.  Defaults to MRO.
//               msgSubCode: The internal code of the sub-board to post the stats message in
//               dictName: The name of the dictionary file (without the extension)
//               numDefinitionsToShow: The number of definitions from Urban Dictionary to show in the stats post
//               statsJsonName: The name of the JSON file to store the user's stats (without the extension)
//               fromNameCRC16: The CRC-16 value of the from name (lower-cased)
function parseArgs(pArgv)
{
	var retObj = {
		cfgFilename: js.exec_dir + "msgbase_AI_chat.ini"
	};

	for (var i = 0; i < pArgv.length; ++i)
	{
		if (pArgv[i][0] == "-")
		{
			var equalsIdx = pArgv[i].indexOf("=");
			if (equalsIdx > 0)
			{
				var optNameLower = pArgv[i].substr(1, equalsIdx-1).toLowerCase();
				if (optNameLower == "settingsfile")
				{
					retObj.cfgFilename = js.exec_dir + pArgv[i].substr(equalsIdx+1) + ".ini";
					break;
				}
			}
		}
	}

	return retObj;
}

// Reads a configuration file
//
// Parameters:
//  pFilename: The fully-pathed name of the file to read
//
// Return value: An object with the following properties:
//               fileSuccess: Whether or not the file was successfully read
//               decodeUTF8: Whether or not to decode UTF-8 text in the response to CP437
//               subCodes: An array of sub-board codes for sub-boards to scan
//               botName: The name of the bost, to use for the 'from' name in message posts
//               otherNamesToLookFor: An array of other 'from' names to look for, which this script should respond to.
//                                    These names will be all uppercase for case-insensitive matching.
//               fromNamesToIgnore: An array of 'from' names to ignore (will have precedence over otherNamesToLookFor).
//                                  These names will be all uppercase for case-insensitive matching.
//               subjectsToLookFor: An array of subjects to look for. If empty, won't be used. This will be
//                                  used in conjunction with other items such as otherNamesToLookFor.
//               msgIncludeTime: Integer; the timestamp to start replying to messages (# seconds since Jan. 1, 1970)
//               conversationEndPhraseFilename: A name of a file containing a list of phrases that would end a conversation
//               topicsFilename: A name of a file containing a list of conversation topics (subject, message text, and blank line for each topic)
//               additionalTextFilename: A name of a file containing additional text to send, mainly for requests to the AI
//               dictionaryFilenameForWordsAndPhrasesToLookFor: A name of a file to use as a dictionary of words & phrases to look for
//                                                              in messages; will respond when one of the words/phrases is seen
//               useDictionaryAndFromAndSubject: If a dictionary is used, use 'AND' logic to look for those words AND the
//                                               specified 'from' name(s) and subject, if provided
//               savedProgressFilename: The name of the JSON file to save progress to
//               AIBackend: A string that specifies which AI back-end to use (GOOGLE_GEMINI or OPENAI)
//               google_gemini: An object with properties for use with Gogle Gemini:
//                              APIKey: The Google Gemini API key
//                              modelName: The name of the Gemini model to use
//               openAI: An object with properties for use with OpenAI (ChatGPT):
//                       APIKey: The API key for use with OpenAI
//                       modelName: The name of the AI model to use from OpenAI
function readConfigurationFile(pFilename)
{
	var retObj = {
		fileSuccess: false,
		decodeUTF8: false,
		subCodes: [],
		botName: "Robert McSchmidtski",
		lookForMsgsToAll: true,
		lookForMsgsToBot: true,
		lookInMsgBodyForBot: false,
		otherNamesToLookFor: [],
		fromNamesToIgnore: [],
		subjectsToLookFor: [],
		msgIncludeTime: 0,
		//conversationEndPhraseFilename: js.exec_dir + "conversationEndPhrases.txt",
		conversationEndPhraseFilename: "",
		topicsFilename: js.exec_dir + "topics.txt",
		additionalTextFilename: "",
		dictionaryFilenameForWordsAndPhrasesToLookFor: "",
		useDictionaryAndFromAndSubject: false,
		savedProgressFilename: "msgbase_AI_chat.json",
		AIBackend: "GOOGLE_GEMINI",
		google_gemini: {
			APIKey: "",
			modelName: "gemini-2.0-flash-lite",
			temperature: 2.0,
			topP: 0.95,
			topK: 40
		},
		openAI: {
			APIKey: "",
			modelName: "gpt-4o-mini"
		}
	};

	var inFile = new File(pFilename);
	if (inFile.open("r"))
	{
		var behaviorSettings = inFile.iniGetObject("behavior");
		var googleGeminiSettings = inFile.iniGetObject("google_gemini");
		var openAISettings = inFile.iniGetObject("openAI");
		inFile.close();
		retObj.fileSuccess = true;

		// Behavior settings
		if (behaviorSettings != null)
		{
			var strPropsToCopy = ["botName"];
			for (var i = 0; i < strPropsToCopy.length; ++i)
			{
				var prop = strPropsToCopy[i];
				if (typeof(behaviorSettings[prop]) === "string" && behaviorSettings[prop].length > 0)
					retObj[prop] = behaviorSettings[prop];
			}

			var boolPropsToCopy = ["decodeUTF8", "lookForMsgsToAll", "lookForMsgsToBot", "lookInMsgBodyForBot", "useDictionaryAndFromAndSubject"];
			for (var i = 0; i < boolPropsToCopy.length; ++i)
			{
				var prop = boolPropsToCopy[i];
				if (typeof(behaviorSettings[prop]) === "boolean")
					retObj[prop] = behaviorSettings[prop];
			}

			if (behaviorSettings.hasOwnProperty("msgIncludeTime") && typeof(behaviorSettings.msgIncludeTime) === "string" && behaviorSettings.msgIncludeTime.length > 0)
			{
				var now = time();
				retObj.msgIncludeTime = getAdjustedTime(behaviorSettings.msgIncludeTime, now);
				if (retObj.msgIncludeTime == now) // Probably invalid time adjustment string
					retObj.msgIncludeTime = getAdjustedTime("-2M", time());
			}
			else
				retObj.msgIncludeTime = getAdjustedTime("-2M", time());

			if (behaviorSettings.hasOwnProperty("savedProgressFilenameBase") && typeof(behaviorSettings.savedProgressFilenameBase) === "string" && behaviorSettings.savedProgressFilenameBase.length > 0)
				retObj.savedProgressFilename = js.exec_dir + behaviorSettings.savedProgressFilenameBase + ".json";

			var fullFilenamePropsToCopy = ["conversationEndPhraseFilename", "topicsFilename", "additionalTextFilename", "dictionaryFilenameForWordsAndPhrasesToLookFor"];
			for (var i = 0; i < fullFilenamePropsToCopy.length; ++i)
			{
				var filenameProp = fullFilenamePropsToCopy[i];
				if (behaviorSettings.hasOwnProperty(filenameProp) && typeof(behaviorSettings[filenameProp]) === "string" && behaviorSettings[filenameProp].length > 0)
					retObj[filenameProp] = js.exec_dir + behaviorSettings[filenameProp];
			}
			
			if (behaviorSettings.hasOwnProperty("AIBackend") && typeof(behaviorSettings.AIBackend) === "string" && behaviorSettings.AIBackend.length > 0)
				retObj.AIBackend = behaviorSettings.AIBackend.toUpperCase();

			var seenNamesToLookFor = {}; // For adding other names to look for & making sure there are no duplicates
			if (behaviorSettings.hasOwnProperty("otherNamesToLookFor") && typeof(behaviorSettings.otherNamesToLookFor) === "string" && behaviorSettings.otherNamesToLookFor.length > 0)
			{
				// Make sure there are no duplicates
				var nameArray = behaviorSettings.otherNamesToLookFor.split(",");
				for (var i = 0; i < nameArray.length; ++i)
				{
					var nameUpper = truncsp(skipsp(nameArray[i])).toUpperCase();
					if (!seenNamesToLookFor.hasOwnProperty(nameUpper))
					{
						retObj.otherNamesToLookFor.push(nameUpper);
						seenNamesToLookFor[nameUpper] = true;
					}
				}
			}
			var seenNamesToIgnore = {}; // For adding other names to ignore & making sure there are no duplicates
			if (behaviorSettings.hasOwnProperty("fromNamesToIgnore") && typeof(behaviorSettings.fromNamesToIgnore) === "string" && behaviorSettings.fromNamesToIgnore.length > 0)
			{
				// Make sure there are no duplicates
				var nameArray = behaviorSettings.fromNamesToIgnore.split(",");
				for (var i = 0; i < nameArray.length; ++i)
				{
					var nameUpper = truncsp(skipsp(nameArray[i])).toUpperCase();
					if (!seenNamesToIgnore.hasOwnProperty(nameUpper))
					{
						retObj.fromNamesToIgnore.push(nameUpper);
						seenNamesToIgnore[nameUpper] = true;
					}
				}
			}
			var seenSubjectsToLookFor = {}; // For adding subjects to look for & making sure there are no duplicates
			if (behaviorSettings.hasOwnProperty("subjectsToLookFor") && typeof(behaviorSettings.subjectsToLookFor) === "string" && behaviorSettings.subjectsToLookFor.length > 0)
			{
				// Make sure there are no duplicates
				var subjArray = behaviorSettings.subjectsToLookFor.split(",");
				for (var i = 0; i < subjArray.length; ++i)
				{
					var subject = truncsp(skipsp(subjArray[i]));
					if (!seenSubjectsToLookFor.hasOwnProperty(subject))
					{
						retObj.subjectsToLookFor.push(subject);
						seenSubjectsToLookFor[subject] = true;
					}
				}
			}

			// Sub-board codes to exclude - Reading this before populating subBoards
			var subCodesToExclude = {};
			if (behaviorSettings.hasOwnProperty("excludeSubCodes") && typeof(behaviorSettings.excludeSubCodes) === "string" && behaviorSettings.excludeSubCodes.length > 0)
			{
				var subCodes = behaviorSettings.excludeSubCodes.toLowerCase().split(",");
				for (var i = 0; i < subCodes.length; ++i)
				{
					var subCode = truncsp(skipsp(subCodes[i]));
					subCodesToExclude[subCode] = true;
				}
			}

			// Sub-board codes
			var seenSubCodes = {}; // For adding sub-board codes & making sure there are no duplicates
			if (behaviorSettings.hasOwnProperty("subCodes") && typeof(behaviorSettings.subCodes) === "string" && behaviorSettings.subCodes.length > 0)
			{
				// Make sure there are no duplicates
				var subCodesArray = behaviorSettings.subCodes.toLowerCase().split(",");
				for (var i = 0; i < subCodesArray.length; ++i)
				{
					var subCode = truncsp(skipsp(subCodesArray[i]));
					if (subCodesToExclude.hasOwnProperty(subCode))
						continue;
					if (!seenSubCodes.hasOwnProperty(subCode))
					{
						retObj.subCodes.push(subCode);
						seenSubCodes[subCode] = true;
					}
				}
			}
			if (behaviorSettings.hasOwnProperty("msgGroups") && typeof(behaviorSettings.msgGroups) === "string" && behaviorSettings.msgGroups.length > 0)
			{
				// Add all the sub-boards to retObj.subCodes, and make sure there are no duplicates
				var msgGroupsArray = behaviorSettings.msgGroups.split(",");
				for (var grpI = 0; grpI < msgGroupsArray.length; ++grpI)
				{
					var grpName = truncsp(skipsp(msgGroupsArray[grpI]));
					if (typeof(msg_area.grp[grpName]) === "object")
					{
						for (var subI = 0; subI < msg_area.grp[grpName].sub_list.length; ++subI)
						{
							if (subCodesToExclude.hasOwnProperty(msg_area.grp[grpName].sub_list[subI].code))
								continue;
							if (!seenSubCodes.hasOwnProperty(msg_area.grp[grpName].sub_list[subI].code))
							{
								retObj.subCodes.push(msg_area.grp[grpName].sub_list[subI].code);
								seenSubCodes[msg_area.grp[grpName].sub_list[subI].code] = true;
							}
						}
					}
					else
						log(LOG_ERR, "* Invalid message group name in configuration: " + grpName);
				}
			}
		}
		else
			log(LOG_ERR, format("* Could not read behavior section of %s!", pFilename));

		// Google Gemini settings
		if (googleGeminiSettings != null)
		{
			strPropsToCopy = ["APIKey", "modelName"];
			for (var i = 0; i < strPropsToCopy.length; ++i)
			{
				var prop = strPropsToCopy[i];
				if (typeof(googleGeminiSettings[prop]) === "string" && googleGeminiSettings[prop].length > 0)
					retObj.google_gemini[prop] = googleGeminiSettings[prop];
			}
			var numPropsToCopy = ["temperature", "topP", "topK"];
			for (var i = 0; i < numPropsToCopy.length; ++i)
			{
				var prop = numPropsToCopy[i];
				if (googleGeminiSettings.hasOwnProperty(prop) && typeof(googleGeminiSettings[prop]) === "number")
					retObj.google_gemini[prop] = googleGeminiSettings[prop];
			}
		}
		else
			log(LOG_ERR, format("* Could not read google_gemini section of %s!", pFilename));

		// OpenAI settings
		if (openAISettings != null)
		{
			strPropsToCopy = ["APIKey", "modelName"];
			for (var i = 0; i < strPropsToCopy.length; ++i)
			{
				var prop = strPropsToCopy[i];
				if (typeof(openAISettings[prop]) === "string" && openAISettings[prop].length > 0)
					retObj.openAI[prop] = openAISettings[prop];
			}
		}
		else
			log(LOG_ERR, format("* Could not read openAI section of %s!", pFilename));
	}

	if (retObj.msgIncludeTime == 0)
		retObj.msgIncludeTime = getAdjustedTime("-2M", time());

	return retObj;
}

// Reads a saved progress JSON file and returns an object representation of it
function readSavedProgressJSON(pJSONFilename)
{
	var savedProgressObj = {};

	var JSONFile = new File(pJSONFilename);
	if (JSONFile.open("r"))
	{
		var JSONContents = JSONFile.readAll().join("");
		JSONFile.close();
		var objFromFile = JSON.parse(JSONContents);
		if (typeof(objFromFile) === "object")
			savedProgressObj = objFromFile;
	}
	else
		log(LOG_ERR, "Failed to read " + pJSONFilename);

	return savedProgressObj;
}

// Verifies that all configured sub-board codes are valid
function verifyConfiguredSubBoardCodes(pSettings)
{
	var allGood = true;
	for (var i = 0; i < pSettings.subCodes.length; ++i)
	{
		var subCode = pSettings.subCodes[i];
		//msg_area.sub[subCode]
		if (typeof(msg_area.sub[subCode]) !== "object")
		{
			allGood = false;
			log(LOG_ERR, "** The sub-board code " + subCode + " is invalid!");
		}
	}
	return allGood;
}

// Gets a time value based on now, or a given time, +/- a certain amount of time
//
// Parameters:
//  pTimeAdjustmentStr: A string in the format +##X, where the
//                      + could also be a 0, and X is (h)ours,
//                      (m)inutes, (s)econds, (D)ays, (W)eeks,
//                      (M)onths, or (Y)ears.
//                      For instance, +10M would be 10 months
//                      in the future, -6M would be 6 months in
//                      the past, -20W would be 20 weeks in the
//                      past, etc.
//  pTime: Optional - A time value (i.e., return value of time()); if not specified,
//         the default will be the current time.
function getAdjustedTime(pTimeAdjustmentStr, pTime)
{
	var theTime = (typeof(pTime) === "number" ? pTime : time()); // time() returns # seconds since Jan. 1, 1970 (UTC)
	if (typeof(pTimeAdjustmentStr) !== "string" || pTimeAdjustmentStr.length == 0)
		return theTime;

	var timeVal = theTime;
	// (h)ours, (m)inutes, (s)econds, (D)ays, (W)eeks, (M)onths, (Y)ears
	//var strComponents = /^([+-])([0-9]+)([hmsDWMY])$/.exec(pTimeAdjustmentStr); // Will result in 4 components
	// The following regex allows for floating-point numbers and will result in 5 components;
	// The 4th component can be ignored. If the number doesn't have a decimal point, the
	// 4th component will be undefined.
	var strComponents = /^([+-])(([0-9]*[.])?[0-9]+)([hmsDWMY])$/.exec(pTimeAdjustmentStr);
	if (Array.isArray(strComponents) && strComponents.length == 5)
	{
		var SECONDS_PER_MIN = 60.0;
		var SECONDS_PER_HOUR = 3600.0;
		var SECONDS_PER_DAY = 86400.0;
		var SECONDS_PER_WEEK = 604800.0;
		var SECONDS_PER_30_DAYS = 2592000.0;
		var SECONDS_PER_YEAR = 31536000.0; // Based on 365 days
		// strComponents[0]: Whole string
		// strComponents[1]: + or -
		// strComponents[2]: Number
		// strComponents[3]: Number with nothing after the ., or undefined
		// strComponents[4]: Character
		var valueFloat = parseFloat(strComponents[2]);
		if (!isNaN(valueFloat))
		{
			var adding = (strComponents[1] == "+");
			var specChar = strComponents[4];
			var numSeconds = 0.0;
			if (specChar == "h")
				numSeconds = valueFloat * SECONDS_PER_HOUR;
			else if (specChar == "m")
				numSeconds = valueFloat * SECONDS_PER_MIN;
			else if (specChar == "s")
				numSeconds = valueFloat;
			else if (specChar == "D")
				numSeconds = valueFloat * SECONDS_PER_DAY;
			else if (specChar == "W")
				numSeconds = valueFloat * SECONDS_PER_WEEK;
			else if (specChar == "M")
				numSeconds = valueFloat * SECONDS_PER_30_DAYS;
			else if (specChar == "Y")
				numSeconds = valueFloat * SECONDS_PER_YEAR;
			if (adding)
				timeVal += numSeconds;
			else
				timeVal -= numSeconds;
		}
	}

	return timeVal;
}

// Adjusts a message's when-written time to the BBS's local time.
//
// Parameters:
//  pMsgHdr: A message header object
//
// Return value: The message's when_written_time adjusted to the BBS's local time.
//               If the message header doesn't have a when_written_time or
//               when_written_zone property, then this function will return -1.
function msgWrittenTimeToLocalBBSTime(pMsgHdr)
{
	if (!pMsgHdr.hasOwnProperty("when_written_time") || !pMsgHdr.hasOwnProperty("when_written_zone_offset") || !pMsgHdr.hasOwnProperty("when_imported_zone_offset"))
		return -1;

	//when_written_time
	//when_written_zone
	//when_written_zone_offset

	var timeZoneDiffMinutes = pMsgHdr.when_imported_zone_offset - pMsgHdr.when_written_zone_offset;
	//var timeZoneDiffMinutes = pMsgHdr.when_written_zone - system.timezone;
	var timeZoneDiffSeconds = timeZoneDiffMinutes * 60;
	var msgWrittenTimeAdjusted = pMsgHdr.when_written_time + timeZoneDiffSeconds;
	return msgWrittenTimeAdjusted;
}

// Reads a file into an array and returns the array
//
// Parameters:
//  pFilename: The name of the file to read
//  pDiscardEmptyLines: Optional - Whether or not to discard empty lines. Defaults to false.
function readFileIntoArray(pFilename, pDiscardEmptyLines)
{
	var discardEmptyLines = (typeof(pDiscardEmptyLines) === "boolean" ? pDiscardEmptyLines : false);
	var fileArray = [];
	var inFile = new File(pFilename);
	if (inFile.open("r"))
	{
		fileArray = inFile.readAll(2048);
		inFile.close();
	}
	if (discardEmptyLines)
	{
		var newArray = [];
		for (var i = 0; i < fileArray.length; ++i)
		{
			if (fileArray[i].length > 0)
				newArray.push(fileArray[i]);
		}
		fileArray = newArray;
	}
	return fileArray;
}

// Reads a topics file.  Returns an array of objects with 'subject' and 'msgText' properties.
function readTopicsFile(pFilename)
{
	var topicObjs = [];

	var inFile = new File(pFilename);
	if (inFile.open("r"))
	{
		var fileArray = inFile.readAll();
		inFile.close();
		// Each entry should have the subject and message text on 2 separate lines, and
		// there should be an empty line between them (or at least, we don't care about
		// that line)
		for (var i = 0; i < fileArray.length; i += 3)
		{
			if (fileArray[i].length > 0 && fileArray[i+1].length > 0)
			{
				topicObjs.push({
					subject: fileArray[i],
					msgText: fileArray[i+1]
				});
			}
		}
	}

	return topicObjs;
}

// Gets a response from Google Gemini
//
// Parameters:
//  pSettings: The settings object
//  pText: The text to send to Google Gemini
//  pOriginalMsgIsFromBot: Whether the message being replied to is from a bot (if not, then assume a user)
//  pAdditionalTextLines: Optional - An array of additional text lines to add to the request
//
// Return code: An object response
function getGoogleGeminiResponse(pSettings, pText, pOriginalMsgIsFromBot, pAdditionalTextLines)
{
	if (typeof(pSettings) !== "object" || !pSettings.hasOwnProperty("google_gemini"))
		return {};
	var geminiConfig = pSettings.google_gemini;
	if (typeof(geminiConfig.APIKey) !== "string" || geminiConfig.APIKey.length == 0 || typeof(pText) !== "string")
		return {};

	var contentRole = "user"; // For the Gemini API - "user "(user-generated) or "model"
	var originalMsgIsFromBot = (typeof(pOriginalMsgIsFromBot) === "boolean" ? pOriginalMsgIsFromBot : false);
	if (originalMsgIsFromBot)
		contentRole = "model";
	contentRole = "user"; // Just using user for now

	var URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + geminiConfig.APIKey;
	var httpRequest = new HTTPRequest();
	httpRequest.extra_headers = { "Content-Type": "application/json" };
	//https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference
	var dataObj = {
		model: geminiConfig.modelName,
		generationConfig: {
			temperature: geminiConfig.temperature,
			topP: geminiConfig.topP,
			topK: geminiConfig.topK,
			//maxOutputTokens: 8192,
			responseMimeType: "text/plain"
		},
		// Contents - Role is "user" (user-generated) or "model"
		contents: [{ role: contentRole,
		             parts: [{text: pText}
		                     //,{text: "Give a large creative answer. Don't try to end the conversation. Don't quote this in your reply."}
							 //,{text: "Give a large creative answer. Don't try to end the conversation."}
		                     //,{text: "You can also be humorous, sometimes to the point of absurdity. Don't quote this in your reply."},

		                    //,{text: "You can also be humorous sometimes. Don't quote this in your reply."}

		                     //,{text: "You can use some emojis if you want to."}
		                     //,{text: "If you think the conversation is over, think of another subject."}
		                    ]
		           }],
		/*
		// systemInstruction: Available for gemini-1.5-flash, gemini-1.5-pro, and gemini-1.0-pro-002.
		// role is ignored.
		systemInstruction: {
			//parts: [{ text: "If you think the conversation is over, think of another subject." }]
			parts: [{ text: "You can also be humorous sometimes. Don't quote this in your reply." }]
		}
		*/
	};
	// Add any additional text lines to the requestvar hasSystemInstructionAndParts = (dataObj.hasOwnProperty("systemInstruction") && Array.isArray(dataObj.systemInstruction));
	if (Array.isArray(pAdditionalTextLines) && pAdditionalTextLines.length > 0)
	{
		// If the systemInstruction object and/or its 'parts' array is missing, then add it; we'll
		// be appending the text lines to it.
		if (!dataObj.hasOwnProperty("systemInstruction"))
		{
			dataObj.systemInstruction = {
				parts: []
			};
		}
		else if (!dataObj.systemInstruction.hasOwnProperty("parts"))
			dataObj.systemInstruction.parts = [];
		// Append the text lines
		for (var i = 0; i < pAdditionalTextLines.length; ++i)
		{
			dataObj.contents[0].parts.push({
				text: pAdditionalTextLines[i]
			});
			dataObj.systemInstruction.parts.push({
				text: pAdditionalTextLines[i]
			});
		}
	}
	// Send the request and get the response
	var response =  httpRequest.Post(URL, JSON.stringify(dataObj), undefined, undefined, "application/json");
	if (response != "")
		return JSON.parse(response);
	else
		return {};
}


// Gets a response from OpenAI ChatGPT
//
// Parameters:
//  pSettings: The settings object
//  pText: The text to send to Google Gemini
//
// Return code: An object response
function getOpenAIChatResponse(pSettings, pText)
{
	if (typeof(pSettings) !== "object" || !pSettings.hasOwnProperty("google_gemini"))
		return {};
	var openAIConfig = pSettings.openAI;
	if (typeof(openAIConfig.APIKey) !== "string" || openAIConfig.APIKey.length == 0 || typeof(pText) !== "string")
		return {};

	var URL = "https://api.openai.com/v1/chat/completions";
	var APIModelName = "";
	if (typeof(openAIConfig.modelName) === "string" && openAIConfig.modelName.length > 0)
		APIModelName = openAIConfig.modelName;
	else
		APIModelName = "gpt-4o-mini";
	var httpRequest = new HTTPRequest();
	httpRequest.extra_headers = {
		"Content-Type": "application/json",
		"Authorization": "Bearer " + openAIConfig.APIKey
	};
	var dataObj = {
		"model": APIModelName,
		"store": true,
		"messages": [
			{
				"role": "user",
				"content": pText
			}
		]
	}
	var response =  httpRequest.Post(URL, JSON.stringify(dataObj), undefined, undefined, "application/json");
	if (response != "")
		return JSON.parse(response);
	else
		return {};
}

// Replaces certain text phrases in a response from the AI bot
//
// Parameters:
//  pResponse: The response text from the AI bot
//  pSettings: The settings object for this script
//  pFromMsgHdr: The message header for the message being replied to
//
// Return value: The pResponse with phrases replaced as applicable
function replaceTextInAIBotResponse(pResponse, pSettings, pFromMsgHdr)
{
	var newText = pResponse;
	newText = newText.replace(/\[Your Name\]/g, pSettings.botName);
	newText = newText.replace(/\[Your Name\/AI Assistant\]/g, pSettings.botName);
	return newText;
}

function getChatResponse(pSettings, pTextToSend, pOriginalmsgIsFromBot, pAdditionalTextLines, pMsgHdr)
{
	var retObj = {
		gotValidResponse: false,
		responseText: ""
	};

	if (pSettings.AIBackend == "GOOGLE_GEMINI")
	{
		log(LOG_INFO, "Getting a response from Google Gemini...");
		var responseObj = getGoogleGeminiResponse(pSettings, pTextToSend, pOriginalmsgIsFromBot, pAdditionalTextLines);
		if (responseObj.hasOwnProperty("candidates") && Array.isArray(responseObj.candidates) && responseObj.candidates.length > 0)
		{
			if (responseObj.candidates[0].hasOwnProperty("content") && Array.isArray(responseObj.candidates[0].content.parts) && responseObj.candidates[0].content.parts.length > 0)
			{
				if (responseObj.candidates[0].content.parts[0].hasOwnProperty("text"))
				{
					responseText = responseObj.candidates[0].content.parts[0].text;
					retObj.gotValidResponse = (responseText.length > 0);
					if (gSettings.decodeUTF8 && str_is_utf8(responseText))
						responseText = utf8_decode(responseObj.candidates[0].content.parts[0].text);
					retObj.responseText = responseText;
				}
			}
		}
		else if (responseObj.hasOwnProperty("error"))
		{
			if (responseObj.error.hasOwnProperty("message"))
			{
				var errorText = responseObj.error.message;
				if (responseObj.error.hasOwnProperty("code"))
					errorText += " (code: " + responseObj.error.code + ")";
				log(LOG_ERROR, "* Failed to get Google Gemini response: " + errorText);
			}
			else
				log(LOG_ERROR, "* Failed to get Google Gemini response: Unknown (\"error\" exists but no message)");
		}
		else
			log(LOG_ERROR, "* Failed to get Google Gemini response: Unknown (No known object properties in the response)");
	}
	else if (pSettings.AIBackend == "OPENAI")
	{
		log(LOG_INFO, "Getting a response from OpenAI (ChatGPT)...");
		var responseObj = getOpenAIChatResponse(pSettings, pTextToSend);
		if (responseObj.hasOwnProperty("choices") && Array.isArray(responseObj.choices) && responseObj.choices.length > 0)
		{
			if (responseObj.choices[0].hasOwnProperty("message") && responseObj.choices[0].message.hasOwnProperty("content"))
			{
				var text = responseObj.choices[0].message.content;
				retObj.gotValidResponse = (text.length > 0);
				if (gSettings.decodeUTF8 && str_is_utf8(text))
					text = utf8_decode(responseObjresponseObj.choices[0].message.content);
				retObj.responseText = text;
			}
		}
		else if (responseObj.hasOwnProperty("error"))
		{
			if (responseObj.error.hasOwnProperty("message"))
				log(LOG_ERROR, "* Failed to get ChatGPT response: " + responseObj.error.message);
			else
				log(LOG_ERROR, "* Failed to get ChatGPT response: Unknown (\"error\" exists but no message)");
		}
		else
			log(LOG_ERROR, "* Failed to get ChatGPT response: Unknown (No known object properties in the response)");
	}

	// Replace certain phrases in the bot's response (such as "[Your Name]", etc.).
	// Originally for Google Gemini.
	if (retObj.responseText.length > 0 && typeof(pMsgHdr) === "object")
		retObj.responseText = replaceTextInAIBotResponse(retObj.responseText, pSettings, pMsgHdr);

	return retObj;
}

// Replaces certain text phrases in a response line from the AI bot
//
// Parameters:
//  pTextLine: The text line from the AI bot response
//  pSettings: The settings object for this script
//  pFromMsgHdr: The message header for the message being replied to
//
// Return value: The given text line with phrases replaced as applicable
function replaceTextInAIResponseByLine(pTextLine, pSettings, pFromMsgHdr)
{
	var newTextLine = pTextLine;
	if (/^\[Your Name\]/.test(newTextLine))
		newTextLine = pSettings.botName + newTextLine.substr(11);
	return newTextLine;
}

function logObject(pLogLevel, pLogLabel, pObj, pNumSpaces)
{
	if (typeof(pObj) !== "object")
		return;
	if (typeof(pLogLabel) === "string" && pLogLabel.length > 0)
		log(pLogLevel, pLogLabel);

	var leadingSpaces = "";
	var numLeadingSpaces = 0;
	if (typeof(pNumSpaces) === "number" && pNumSpaces > 0)
	{
		numLeadingSpaces = pNumSpaces;
		leadingSpaces = format("%*s", numLeadingSpaces, "");
	}

	for (var prop in pObj)
	{
		/*
		if (Array.isArray(pObj[prop]))
		{
			log(pLogLevel, prop + ":");
			var arrayLeadingSpaces = format("%*s", numLeadingSpaces+1, "");
			for (var i = 0; i < pObj[prop].length; ++i)
				log(pLogLabel, arrayLeadingSpaces + pObj[prop][i]);
		}
		else*/ if (typeof(pObj[prop]) === "object")
		{
			log(pLogLevel, prop + ":");
			logObject(pLogLevel, null, pObj[prop], numLeadingSpaces+1);
		}
		else
			log(pLogLevel, leadingSpaces + prop + ": " + pObj[prop] + " (" + typeof(pObj[prop]) + ")");
	}
}

/////////////////////////////////////////////////
// Message section stuff

// Gets an an aray of message sections from an array of text lines.
// This was originally a helper for wrapTextLinesForQuoting() in
// SlyEdit_Misc.js
//
// Parameters:
//  pTextLines: An array of strings
//
// Return value: An array of MsgSection objects representing the different sections of the message with various
//               quote prefixes
function getMsgSections(pTextLines)
{
	var msgSections = [];

	var lastQuotePrefix = findPatternedQuotePrefix(pTextLines[0]);
	var startLineIdx = 0;
	var lastLineIdx = 0;
	for (var i = 1; i < pTextLines.length; ++i)
	{
		var quotePrefix = findPatternedQuotePrefix(pTextLines[i]);
		var lineIsOnlyPrefix = pTextLines[i] == quotePrefix;
		quotePrefix = quotePrefix.replace(/\s+$/, "");
		if (lineIsOnlyPrefix)
			quotePrefix = "";
		//if (quotePrefix.length == 0)
		//	continue;

		if (quotePrefix != lastQuotePrefix)
		{
			if (lastQuotePrefix.length > 0)
				msgSections.push(new MsgSection(startLineIdx, i-1, lastQuotePrefix));
			startLineIdx = i;
		}

		lastQuotePrefix = quotePrefix;
	}
	if (msgSections.length > 0)
	{
		// Add the message sections that are missing (no prefix)
		var lineStartIdx = 0;
		var lastEndIdxSeen = 0;
		var numSections = msgSections.length;
		for (var i = 0; i < numSections; ++i)
		{
			if (msgSections[i].begLineIdx > lineStartIdx)
				msgSections.push(new MsgSection(lineStartIdx, msgSections[i].begLineIdx-1, ""));
			lineStartIdx = msgSections[i].endLineIdx + 1;
			lastEndIdxSeen = msgSections[i].endLineIdx;
		}
		if (lastEndIdxSeen+1 < pTextLines.length - 1)
			msgSections.push(new MsgSection(lastEndIdxSeen+1, pTextLines.length - 1, ""));
		// Sort the message sections (by beginning line index)
		msgSections.sort(function(obj1, obj2) {
			if (obj1.begLineIdx < obj2.begLineIdx)
				return -1;
			else if (obj1.begLineIdx == obj2.begLineIdx)
				return 0;
			else if (obj1.begLineIdx > obj2.begLineIdx)
				return 1;
		});
	}
	else // There are no message sections; add one for the whole message with no prefix
		msgSections.push(new MsgSection(0, pTextLines.length - 1, ""));

	return msgSections;
}
// Helper for wrapTextLinesForQuoting(): Creates an object containing information aboug a message section (with or without a common line prefix)
function MsgSection(pBegLineIdx, pEndLineIdx, pLinePrefix)
{
	this.begLineIdx = pBegLineIdx;
	this.endLineIdx = pEndLineIdx;
	this.linePrefix = pLinePrefix;
}
// Looks for a quote prefix with a typical pattern at the start of a string.
// Returns it if found; returns an empty string if not found.
//
// Parameters:
//  pStr: A string to search
//
// Return value: The string's quote prefix, if found, or an empty string if not found
function findPatternedQuotePrefix(pStr)
{
	var strPrefix = "";
	// See if there is a quote prefix with a typical pattern (possibly a space with
	// possibly some characters followed by a > and a space).  Make sure it only gets
	// the first instance of a >, in case there are more.  Look for the first > and
	// get a substring with just that one and try to match it with a regex of a pattern
	// followed by >
	// First, look for just alternating spaces followed by > at the start of the string.
	//var prefixMatches = pStr.match(/^( *>)+ */);
	var prefixMatches = pStr.match(/^( *\S*>)+ */); // Possible whitespace followed by possible-non-whitespace
	if (Array.isArray(prefixMatches) && prefixMatches.length > 0)
	{
		if (pStr.indexOf(prefixMatches[0]) == 0) // >= 0
			strPrefix = prefixMatches[0];
	}
	else
	{
		// Alternating spaces and > at the start weren't found.  Look for the first >
		// and if found, see if it has any spaces & characters before it
		var GTIdx = pStr.indexOf("> "); // Look for the first >
		if (GTIdx >= 0)
		{
			///*var */prefixMatches = pStr.substr(0, GTIdx+2).match(/^ *[\d\w\W]*> /i);
			// substrWithAttrCodes() is defined in dd_lightbar_menu.js
			var len = pStr.length - (GTIdx+2);
			prefixMatches = substrWithAttrCodes(pStr, 0, GTIdx+2, len).match(/^ *[\d\w\W]*> /i);
			if (Array.isArray(prefixMatches) && prefixMatches.length > 0)
			{
				if (pStr.indexOf(prefixMatches[0]) == 0) // >= 0
					strPrefix = prefixMatches[0];
			}
		}
	}
	// If the prefix is over a certain length, then perhaps it's not actually a valid
	// prefix
	if (strPrefix.length > 40)
		strPrefix = "";
	return strPrefix;
}
// Returns whether a text line is a tear line ("---") or an origin line
function msgLineIsTearLineOrOriginLine(pTextLine)
{
	return (pTextLine == "---" || pTextLine.indexOf("--- ") == 0 || pTextLine.indexOf(" --- ") == 0 || pTextLine.indexOf(" * Origin: ") == 0);
}
// Returns whether a string is empty or only whitespace
function stringIsEmptyOrOnlyWhitespace(pString)
{
	if (typeof(pString) !== "string")
		return false;
	return (pString.length == 0 || /^\s+$/.test(pString));
}

/////////////////////////////////////////////////
// End of message section stuff