"""Points heddrate.com at the Heddify website (once): the player answers "/" and its own pages,
the old site's files and the services keep their addresses. Run as root on the server; prints
"already" when the config has it."""
import sys

PATH = '/etc/nginx/sites-available/heddrate'
s = open(PATH, encoding='utf-8').read()
if '@heddify' in s:
    print('already')
    sys.exit(0)

OLD_INDEX = '    location = /index.html { expires -1; }\n'
OLD_ROOT = '''    location / {
        try_files $uri $uri/ =404;
    }
'''
NEW_ROOT = '''    # Heddify (the player) is the site: its files are in /var/www/heddify/current (heddify-web-sync);
    # the old site's files and the services above keep their addresses
    location = / {
        root /var/www/heddify/current;
        try_files /index.html =404;
        expires -1;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
    }

    location /assets/ {
        root /var/www/heddify/current;
        expires 1y;
        access_log off;
    }

    location = /version.json {
        root /var/www/heddify/current;
        expires -1;
    }

    location = /icon.png {
        root /var/www/heddify/current;
        expires 7d;
    }

    # any other address that is no file here is a page of the player (/wave, /search?q=…)
    location / {
        try_files $uri $uri/ @heddify;
    }

    location @heddify {
        root /var/www/heddify/current;
        try_files /index.html =404;
        expires -1;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "no-referrer" always;
    }
'''
for old in (OLD_INDEX, OLD_ROOT):
    if s.count(old) != 1:
        print('unexpected config: not changed')
        sys.exit(2)
s = s.replace(OLD_INDEX, '    location = /index.html { return 301 /; }\n').replace(OLD_ROOT, NEW_ROOT)
open(PATH, 'w', encoding='utf-8').write(s)
print('changed')
