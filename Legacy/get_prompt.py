import json

with open('/Users/yashsomani/.gemini/antigravity/brain/76a8d3fb-b911-4875-ac81-7cdbacccc422/.system_generated/logs/transcript_full.jsonl', 'r') as f:
    for line in f:
        if not line.strip(): continue
        data = json.loads(line)
        if data.get('type') == 'USER_INPUT' and 'MASTER IMPLEMENTATION PROMPT' in data.get('content', ''):
            with open('full_prompt.txt', 'w') as out:
                out.write(data['content'])
            print('Saved to full_prompt.txt')
            break
