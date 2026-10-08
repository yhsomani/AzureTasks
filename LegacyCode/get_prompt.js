const fs = require('fs');
const lines = fs.readFileSync('/Users/yashsomani/.gemini/antigravity/brain/76a8d3fb-b911-4875-ac81-7cdbacccc422/.system_generated/logs/transcript_full.jsonl', 'utf8').split('\n');
for (const line of lines) {
  if (!line) continue;
  const data = JSON.parse(line);
  if (data.type === 'USER_INPUT' && data.content.includes('MASTER IMPLEMENTATION PROMPT')) {
    fs.writeFileSync('full_prompt.txt', data.content);
    console.log('Saved to full_prompt.txt');
    break;
  }
}
