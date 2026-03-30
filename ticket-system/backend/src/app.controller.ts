import { Controller, Get } from '@nestjs/common';
import axios from 'axios';

@Controller()
export class AppController {
  private bingCache: {
    imageUrl: string;
    title: string;
    fetchedAt: number;
  } | null = null;

  @Get('health')
  health() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('public/bing-background')
  async bingBackground() {
    const now = Date.now();
    const cacheTtlMs = 6 * 60 * 60 * 1000; // 6 hours
    if (this.bingCache && now - this.bingCache.fetchedAt < cacheTtlMs) {
      return this.bingCache;
    }

    const fallback = {
      imageUrl: 'https://www.bing.com/th?id=OHR.OdeonAthens_EN-US2166580245_1920x1080.jpg',
      title: 'Bing Daily Wallpaper',
      fetchedAt: now,
    };

    try {
      const { data } = await axios.get('https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN', {
        timeout: 5000,
      });
      const image = data?.images?.[0];
      if (!image?.url) {
        this.bingCache = fallback;
        return this.bingCache;
      }

      this.bingCache = {
        imageUrl: `https://www.bing.com${image.url}`,
        title: image.copyright || 'Bing Daily Wallpaper',
        fetchedAt: now,
      };
      return this.bingCache;
    } catch {
      this.bingCache = fallback;
      return this.bingCache;
    }
  }
}
