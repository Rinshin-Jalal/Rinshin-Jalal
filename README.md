<div align="center">

<a href="https://window.rinsh.in/tap">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://window.rinsh.in/window.svg?theme=dark">
    <img ismap src="https://window.rinsh.in/window.svg?theme=light" width="840" alt="A live pixel window into the hills of Kerala where I live. The sky follows the real time there, the weather is the real weather, and the window is lit when I'm up.">
  </picture>
</a>

<sub>a live window into the hills where i live. the sky is the real time there, the rain is real rain, and the laptop glows when i've pushed recently.<br>
click the chai to send me one. if the window says i haven't shipped today, <a href="https://window.rinsh.in/callout">call me out</a>: it buzzes my phone.<br>
on mobile: <a href="https://window.rinsh.in/chai">send chai</a> · <a href="https://window.rinsh.in/callout">call me out</a> · <a href="https://window.rinsh.in/building">what i'm building</a></sub>

</div>

### rinshin jalal

i build useful things for people. applied ai from kerala: agents, voice, and products that actually get used.

- **now** · member of technical staff at [xoompark](https://xoompark.co), and running **no excuse labs** on the side: 4 products in 30 days
- **before** · built voiceship, voice ai for shopify stores, from zero until talkforce ai bought it
- **how i build** · an agent gets a spend cap, an audit trail and a human in the loop before it touches real data

`typescript` · `next.js` · `react native` · `node` · `postgres` · `supabase` · `langchain` · `voice ai` · `cloudflare`

[rinsh.in](https://rinsh.in) · [hey@rinsh.in](mailto:hey@rinsh.in) · [linkedin](https://linkedin.com/in/rinshin-jalal) · [x](https://x.com/rinshin_jalal)

<details>
<summary><sub>how the window works</sub></summary>

<br>

- a [cloudflare worker](window/) draws the scene as a pixel-art svg every time this page loads. no javascript, no images, just rects
- the time is the real time in kerala (ist), so you'll see the sun, the moon, or the stars
- the weather is live from [open-meteo](https://open-meteo.com) for the hills around nilambur: mist, rain, monsoon storms and fog all draw differently
- the lit window, the glowing laptop and the "shipped today" line come from my public github push events
- clicks work because the image is an `<img ismap>` inside a link: your browser sends the x,y of the click, and the worker works out whether you hit the chai, the callout or the laptop
- a callout only buzzes my phone on a day i haven't pushed anything. one per visitor per day, so please don't feel bad

</details>
