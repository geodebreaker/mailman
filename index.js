require('dotenv').config({ quiet: true });
const resend = new (require('resend')).Resend(process.env.MAILTOKEN);
const discord = require('discord.js');
const cli = new discord.Client({
  intents: [
    discord.GatewayIntentBits.MessageContent,
    discord.GatewayIntentBits.GuildMessages,
    discord.GatewayIntentBits.Guilds,
  ]
});

cli.on('messageCreate', /** @param {discord.Message} t */ async t => {
  if (t.author.bot ||
    !t.channel.isThread() ||
    t.channel.parent?.parent.name != 'mail') return;
  let alias = t.channel.parent.name;
  let m = (await t.channel.messages.fetch({ limit: 1, after: "0" })).first();
  let subj = (m != t ? 'Re: ' : '') + t.channel.name;
  let to = (m.content.match(/(?<=^to: `?).*?(?=`?\n)/)?.[0] || '').split(',');
  if (m.author.bot) to.push(m.content.match(/(?<=^from: `?).*?(?=`?\n)/)?.[0] || '');
  to = to.filter(x => x && x != alias + '@' + process.env.DOMAIN);
  to = to.filter((x, i, a) => a.indexOf(x) == i);
  let body = t == m ? t.content.replace(/^to: .*?\n/, '') : t.content;
  let attach = await Promise.all(t.attachments.map(async x => [x.name,
  Buffer.from(await fetch(x.url).then(x => x.arrayBuffer()))]));
  let r = await send(alias, to, subj, body, attach);
  if (r.error) console.error(r.error);
});
cli.on('threadCreate', t => {
  if (t.parent.parent?.name == 'mail') t.join();
});
/** @returns {discord.ThreadChannel} */
async function getThread(alias, subj) {
  let guild = await cli.guilds.fetch(process.env.BOTGUILD);
  let channels = await guild.channels.fetch();
  let ch = null;
  channels.forEach(x => {
    if (x.name == alias && x.parent?.name == 'mail') ch = x;
  });
  if (!ch) {
    let cat = channels.find(x => x.name == 'mail' && x.type == discord.ChannelType.GuildCategory);
    if (!cat) cat = await guild.channels.create({
      name: 'mail',
      type: discord.ChannelType.GuildCategory
    });
    ch = await cat.children.create({
      name: alias,
      type: discord.ChannelType.GuildText
    });
  }
  let ts = await ch.threads.fetch();
  let t = null;
  ts.threads.forEach(x => {
    if (x.name == subj) t = x;
  });
  if (!t) t = await ch.threads.create({
    name: subj
  });
  return t;
}

cli.on('ready', () => console.log('ready'));
cli.login(process.env.BOTTOKEN);

async function send(alias, to, subj, html, attach) {
  return await resend.emails.send({
    from: alias + '@' + process.env.DOMAIN,
    to: to,
    subject: subj,
    html: html || ' ',
    attachments: attach.map(x => ({ filename: x[0], content: x[1] }))
  });
}
async function recv(alias, from, to, subj, html, attach) {
  let t = await getThread(alias, subj);
  let as = [];
  attach.forEach(x => {
    let a = new discord.AttachmentBuilder(x[1], { name: x[0] });
    as.push(a);
  });
  t.send({
    content: 'from: `' + from + '`\nto: `' + to + '`\nbody:```\n' +
      html.replaceAll('```', '``\u200c`') + '```',
    files: as
  });
}

const mp = require('mailparser');

require('http').createServer(async (req, res) => {
  let body = await new Promise(y => {
    let l = '';
    req.on('data', x => l += x);
    req.on('end', () => y(l));
  });
  let m = await mp.simpleParser(body);
  let to = (m.to.text + ',' + (m.cc?.text || '') +
    ',' + (m.bcc?.text || '')).split(',');
  to = to.filter((x, i, a) => x && a.indexOf(x) == i);
  recv(req.url.replace('/', ''), m.from.text, to,
    m.subject.replace('Re: ', ''), m.text, m.attachments.map(x => 
      [x.filename, x.content]));
  res.writeHead(204).end();
}).listen(process.env.PORT || 8080);

process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);