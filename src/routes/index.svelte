<script>
	import 'lazysizes';
	import images from '../../data/imagedata.json';

	const imagesPath = 'images/';
	images.map(i => {
		const { slug, sizes, extension, hasRetina } = i;
		i.srcset = sizes.reduce((acc, curr, index, array) => {
			acc += `${imagesPath}${slug}-${curr}.${extension} ${curr}w`;
			if (hasRetina) acc += `, ${imagesPath}${slug}-${curr}_x2.${extension} ${curr*2}w`;
			if (index < array.length - 1) acc += ',';
			return acc;
		}, '');
		return i;
	});
</script>

<svelte:head>
	<title>Sapper project template</title>
</svelte:head>

<h1>Great success!</h1>

<figure>
	<img alt='Success Kid' src='successkid.jpg'>
	<figcaption>Have fun with Sapper!</figcaption>
</figure>

<p><strong>Try editing this file (src/routes/index.svelte) to test live reloading.</strong></p>
{#each images as { slug, sizes, extension, srcset }}
<img alt="" data-sizes="auto" data-srcset="{srcset}" class="big lazyload"/>
{/each}

<style>
	h1,
	figure,
	p {
		text-align: center;
		margin: 0 auto;
	}

	h1 {
		font-size: 2.8em;
		text-transform: uppercase;
		font-weight: 700;
		margin: 0 0 0.5em 0;
	}

	figure {
		margin: 0 0 1em 0;
	}

	img {
		width: 100%;
		max-width: 400px;
		margin: 0 0 1em 0;
	}

	p {
		margin: 1em auto;
	}

	@media (min-width: 480px) {
		h1 {
			font-size: 4em;
		}
	}

	img.big {
		width: 100%;
		max-width: unset;
	}
</style>