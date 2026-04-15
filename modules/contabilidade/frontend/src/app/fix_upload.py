#!/usr/bin/env python3
"""Modify page.tsx to skip R2 upload and go directly to /ingest fallback."""

with open('page.tsx', 'r') as f:
    lines = f.readlines()

# Find the line with "const initResponse = await fetch" inside performUpload
# and replace the entire R2 flow with a direct throw to trigger fallback
new_lines = []
skip_until_catch = False
init_found = False

for i, line in enumerate(lines):
    if 'const initResponse = await fetch' in line and 'storage/uploads/init' in line:
        # Replace this entire block with a throw to force fallback /ingest
        new_lines.append('          // R2 direct upload disabled - using /ingest fallback instead\n')
        new_lines.append('          throw new Error("Direct R2 upload bypassed - using /ingest fallback");\n')
        skip_until_catch = True
        init_found = True
        continue
    
    if skip_until_catch:
        # Skip lines until we find the catch block for this try
        if 'aggregated.rejected.push(...(completeData' in line:
            # This is the last line of the R2 flow before the catch
            skip_until_catch = False
            continue
        continue
    
    new_lines.append(line)

if init_found:
    with open('page.tsx', 'w') as f:
        f.writelines(new_lines)
    print(f"SUCCESS: R2 upload flow replaced with /ingest fallback (processed {len(lines)} lines)")
else:
    print("ERROR: Could not find initResponse line")
