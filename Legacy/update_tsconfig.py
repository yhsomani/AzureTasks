import json

with open('tsconfig.json', 'r') as f:
    config = json.load(f)

config['exclude'].append('src/react-ui/**/*')

with open('tsconfig.json', 'w') as f:
    json.dump(config, f, indent=2)

