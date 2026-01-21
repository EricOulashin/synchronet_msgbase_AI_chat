# Synchronet msgbase AI chat script
This is a JavaScript script/mod for <a href='https://www.synchro.net' target='_blank'>Synchronet</a>
(BBS software) that uses AI chat bots (ChatGPT &amp; Google Gemini) to respond to messages in
Synchronet's message bases.

If you're unfamiliar with a bulletin board system (BBS), a BBS is an old-school style of system that
were popular before the internet, which people would dial into using a modem connected to their
computer.  These days, modern BBS software such as Synchronet runs online so that users can
connect via the internet (with protocols such as Telnet supporting the old-school text interface, but
with other protocols as well such as SSH, RLogin, web (HTTP), newsgroup (NNTP), etc.).  You
can read the following pages for more information:
<a href='https://en.wikipedia.org/wiki/Bulletin_board_system' target='_blank'>Wikipedia article</a>
<a href='https://www.geeksforgeeks.org/computer-networks/what-is-bulletin-board-system/' target='_blank'>GeeksForGeeks article</a>

Synchronet, like most other BBS software packages, provide message bases for people to post
public messages in, and respond to other messages.  These are much like an online forum which
are available today via web forums.  This project is a script/mod that can be configured to scan any
or all of a Synchronet BBS's message bases and reply to messages using AI chat bots (ChatGPT &amp;
Google Gemini) using 

As mentioned above, this is written in JavaScript. Synchronet uses Mozila's embedded JavaScript engine
to allow Synchronet BBS sysops to write '<a href='https://wiki.synchro.net/module:index' target='_blank'>modules</a>'
for Synchronet that provide additional behavior beyond that which is defined by Synchronet's standard C++ code.
You can see <a href='https://wiki.synchro.net/custom:javascript' target='_blank'>this page</a> for more
information on Synchronet's use of JavaScript.

Before you can use this, you will need to create an account with
<a href='https://platform.openai.com/api-keys' target='_blank'>OpenAI (for ChatGPT)</a> (and see
their <a href='https://help.openai.com/en/articles/4936850-where-do-i-find-my-openai-api-key' target='_blank'>Where Do I find My API Key page</a>)
and/or <a href='https://aistudio.google.com' target='_blank'>Google AI Studio</a> for Google Gemini
(and then see their  <a href='https://aistudio.google.com/app/api-keys' target='_blank'>API Keys</a> page
for your API keys). Once you create an account and get your API key(s), you will then need to specify
your API key(s) in the configuration file for this script (msgbase_AI_chat.ini).

## Included files
These are the important files:
<ul>
<li><b>msgbase_AI_chat.js</b>: This is the script. This is meant to be run on the Synchronet (server) side, either manually using Synchronet's <a href='https://wiki.synchro.net/util:jsexec' target='_blank'>jsexec</a> tool, or as a <a href='https://wiki.synchro.net/config:external_programs?s%5B%5D=timed&s%5B%5D=event#timed_event' target='_blank>timed event</a>, configured with Synchronet's configuration utility, <a href='https://wiki.synchro.net/util:scfg' target='_blank'>SCFG</a>.
<li><b>msgbase_AI_chat.ini</b>: An example configuration file for the script. This lets you specify options such as your API key(s) and others. Look at the comments in this file for descriptions of all the configuration options.
<li><b>conversationEndPhrases.txt</b>: A list of "end phrases" to look for to signify whether to start a new topic
<li><b>topics.txt</b>: A list of topics to optinally use as conversation starters for new messages
</ul>