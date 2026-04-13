from PIL import Image
import sys

def main():
    img = Image.open('static/brand_lockup.png').convert('RGBA')
    datas = img.getdata()
    new_data = []
    for item in datas:
        r, g, b = item[:3]
        
        # We can use the max of RGB as the alpha channel, because it's a glow on black.
        alpha = max(r, g, b)
        
        if alpha == 0:
            new_data.append((0, 0, 0, 0))
        else:
            # We scale up the RGB values so when alpha is applied, it yields the original color
            nr = int((r / alpha) * 255)
            ng = int((g / alpha) * 255)
            nb = int((b / alpha) * 255)
            new_data.append((nr, ng, nb, alpha))

    img.putdata(new_data)
    img.save('static/brand_lockup_transparent.png')

if __name__ == '__main__':
    main()
