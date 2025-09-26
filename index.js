require('dotenv').config();
const express=require('express');
const {GoogleGenAI}=require('@google/genai');
const {Client, GatewayIntentBits}=require('discord.js');

const app=express();
const PORT=3000;

const memory=new Map();
const warnings=new Map();

app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(PORT, () => console.log(`Web server running on port ${PORT}`));

const client=new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.once("ready", () =>
{
    console.log("🤖 Bot is ready!");
});

const ai=new GoogleGenAI({
    apiKey: process.env.GOOGLE_API_KEY
});

async function generateContent(message, userPrompt)
{
    const user=message.author;
    const userId=user.id;
    const userMention=`<@${userId}>`;

    const history=memory.get(userId)||[];
    history.push({role: "user", text: userPrompt});

    const contents=[
        {
            type: "system",
            text: `You are a friendly and helpful AI assistant in Discord.
Always start your response by mentioning the user: ${userMention}.
Here is the user's info:
- Username: ${user.username}
- Discriminator: ${user.discriminator}
- User ID: ${user.id}`
        },
        ...history.map(msg => ({
            type: msg.role==="user"? "user":"assistant",
            text: msg.text
        }))
    ];

    const response=await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents
    });

    history.push({role: "assistant", text: response.text});
    memory.set(userId, history.slice(-10));

    return response.text;
}

async function checkContent(userPrompt)
{
    const contents=[
        {type: "system", text: "Check if the message is abusive. If abusive, output 0 only; if safe, output 1."},
        {type: "user", text: userPrompt}
    ];

    const response=await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contents
    });

    const result=response.text.trim();
    return result==="0"? 0:1;
}

client.on("messageCreate", async (message) =>
{
    if (message.author.bot) return;
    const userId=message.author.id;
    const userMention=`<@${userId}>`;

    try
    {
        const isValid=await checkContent(message.content);

        if (isValid===0)
        {
            const userWarnings=warnings.get(userId)||0;

            if (userWarnings===0)
            {
                warnings.set(userId, 1);
                await message.reply(`⚠️ ${message.author}, please avoid using abusive language. This is your first warning.`);
            } else
            {
                try
                {
                    await message.member.kick("Used abusive language after warning");
                    warnings.delete(userId);
                    await message.channel.send(`${message.author.tag} has been kicked for repeated abusive language.`);
                    return;
                } catch (err)
                {
                    console.error("Failed to kick member:", err);
                    await message.reply("❌ I couldn't kick the user due to permissions.");
                }
            }
            return;
        }

        await message.channel.sendTyping();
        const content=await generateContent(message, message.content);

        await message.channel.send(content);

    } catch (err)
    {
        console.error("❌ Error processing message:", err);
        await message.reply("⚠️ Sorry, I couldn't process that message.");
    }
});

client.login(process.env.DISCORD_BOT_TOKEN);
