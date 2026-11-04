"""Present real viewport pairs; retain native evidence originals byte-for-byte."""
from pathlib import Path
from urllib.parse import unquote, urlsplit, quote
from html import escape, unescape
import os
import re

IMAGE_LINK = re.compile(r'<a\b[^>]*href="([^"]*)"[^>]*>\s*<img\b([^>]*)>\s*</a>')

def pair_for(image):
    name=image.name
    if '-desktop.png' in name:
        return image,image.with_name(name.replace('-desktop.png','-mobile.png')),False
    if '-mobile.png' in name:
        return image.with_name(name.replace('-mobile.png','-desktop.png')),image,False
    if '-1440-light.png' in name:
        return image,image.with_name(name.replace('-1440-light.png','-390-dark.png')),True
    if '-390-dark.png' in name:
        return image.with_name(name.replace('-390-dark.png','-1440-light.png')),image,True
    raise ValueError(f'Screenshot needs an actual desktop/mobile pair: {image}')

def format_screenshots(output):
    output=Path(output).resolve()
    count=0
    for page in output.rglob('*.html'):
        seen=set()
        def render(match):
            nonlocal count
            url=urlsplit(unescape(match.group(1)))
            if url.scheme or url.netloc:
                raise ValueError(f'Uncurated remote screenshot in {page}: {url.geturl()}')
            image=(page.parent/unquote(url.path)).resolve()
            desktop,mobile,native=pair_for(image)
            for path in [desktop,mobile]:
                if not path.is_relative_to(output) or not path.is_file():
                    raise ValueError(f'Missing screenshot counterpart: {path}')
            key=(desktop,mobile)
            original=quote(os.path.relpath(image,page.parent).replace(os.sep,'/'),safe='/._-')
            if key in seen:
                return f'<a class="screenshot-original" href="{original}">Open this original capture</a>'
            seen.add(key)
            alt=re.search(r'\balt="([^"]*)"',match.group(2))
            description=unescape(alt.group(1)) if alt else 'Application screenshot'
            if native:description=re.sub(r', (?:1440 px light|390 px dark)', '', description)
            views=[]
            for device,path,ratio,width,height in [('desktop',desktop,'16:9',1440,810),('mobile',mobile,'3:4',390,520)]:
                href=quote(os.path.relpath(path,page.parent).replace(os.sep,'/'),safe='/._-')
                label=f'{device.title()} \u00b7 {ratio}'+(' excerpt' if native else '')
                views.append(f'<span class="screenshot-view screenshot-{device}"><span class="screenshot-label">{label}</span><a href="{href}" title="Open full-resolution {device} capture"><img src="{href}" alt="{escape(description,quote=True)} - {device}" width="{width}" height="{height}"></a></span>')
            count+=1
            return f'<span class="screenshot-pair" role="group" aria-label="{escape(description,quote=True)}: desktop and mobile">'+''.join(views)+'</span>'
        text=page.read_text(encoding='utf-8')
        page.write_text(IMAGE_LINK.sub(render,text),encoding='utf-8')
    print(f'Formatted {count} desktop/mobile screenshot comparisons')
