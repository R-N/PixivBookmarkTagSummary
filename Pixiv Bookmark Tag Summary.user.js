// ==UserScript==
// @name         Pixiv Bookmark Tag Summary
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Count illustrations per tag in bookmarks
// @match        https://www.pixiv.net/*/bookmarks*
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const turboMode = false;
    const bookmarkBatchSize = 100;
    const BANNER = ".sc-x1dm5r-0";
    let uid, lang, token;
    let pageInfo = {};
    let userTags = [];

    let unsafeWindow_ = unsafeWindow;
    
    function delay(ms) {
        return new Promise((res) => setTimeout(res, ms));
    }
    
    async function remove(tags, bookmarkIds){
        const payload = { 
            removeTags: tags,
            bookmarkIds: bookmarkIds,
        };
        const response = await fetch("https://www.pixiv.net/ajax/illusts/bookmarks/remove_tags", {
            headers: {
                accept: "application/json",
                "content-type": "application/json; charset=utf-8",
                //"content-type": "application/x-www-form-urlencoded; charset=utf-8",
                "x-csrf-token": token,
            },
            body: JSON.stringify(payload),
            //body: new URLSearchParams(payload).toString(),
            method: "POST",
        });
        if (response.ok && !response.error) {
            console.log(`Removed ${tags} from ${bookmarkIds}`);
        }else{
            console.error(`Remove of ${tags} failed for ${bookmarkIds} with status ${response.status} and error ${response.error}: ${response.message}`);
        }
        await delay(500);
    }
    async function add(tags, bookmarkIds){
        if (restrict === null){
            restrict = window.location.href.includes("rest=hide") ? 1 : 0;
        }
        const payload = { 
            tags: tags,
            bookmarkIds: bookmarkIds,
        };
        const response = await fetch("https://www.pixiv.net/ajax/illusts/bookmarks/add_tags", {
            headers: {
                accept: "application/json",
                "content-type": "application/json; charset=utf-8",
                //"content-type": "application/x-www-form-urlencoded; charset=utf-8",
                "x-csrf-token": token,
            },
            body: JSON.stringify(payload),
            //body: new URLSearchParams(payload).toString(),
            method: "POST",
        });
        if (response.ok && !response.error) {
            console.log(`Added ${tags} from ${bookmarkIds}`);
        }else{
            console.error(`Add of ${tags} failed for ${bookmarkIds} with status ${response.status} and error ${response.error}: ${response.message}`);
        }
        await delay(500);
    }

    async function removeTags(tags){
        for (const tag of tags) {
            const illusts = Object.values(tag.illustrations).map((illust) => illust.bookmarkId);
            await remove([tag.name], illusts);
        }
    }

    function sortByParody(array) {
        const sortFunc = (a, b) => {
          let reg = /^[a-zA-Z0-9]/;
          if (reg.test(a) && !reg.test(b)) return -1;
          else if (!reg.test(a) && reg.test(b)) return 1;
          else return a.localeCompare(b, "zh");
        };
        const withParody = array.filter((key) => key.includes("("));
        const withoutParody = array.filter((key) => !key.includes("("));
        withoutParody.sort(sortFunc);
        withParody.sort(sortFunc);
        withParody.sort((a, b) => sortFunc(a.split("(")[1], b.split("(")[1]));
        return withoutParody.concat(withParody);
    }

    async function fetchUserTags() {
        const tagsRaw = await fetch(
        `/ajax/user/${uid}/illusts/bookmark/tags?lang=${lang}`
        );
        const tagsObj = await tagsRaw.json();
        if (tagsObj.error === true)
        return alert(
            `获取tags失败
        Fail to fetch user tags` +
            "\n" +
            decodeURI(tagsObj.message)
        );
        let userTagDict = tagsObj.body;
        const userTagsSet = new Set();
        const addTag2Set = (tag) => {
            try {
                userTagsSet.add(decodeURI(tag));
            } catch (err) {
                userTagsSet.add(tag);
                if (err.message !== "URI malformed") {
                    console.log("[Label Pixiv] Error!");
                    console.log(err.name, err.message);
                    console.log(err.stack);
                }
            }
        };
        for (let obj of userTagDict.public) {
            addTag2Set(obj.tag);
        }
        for (let obj of userTagDict["private"]) {
            addTag2Set(obj.tag);
        }
        userTagsSet.delete("未分類");
        return sortByParody(Array.from(userTagsSet));
    }
    
    // Function to bulk remove or remove tags based on minimum bookmark count
    async function bulkRemove(minBookmarks) {
        // Filter tags based on the bookmark count
        const selectedTags = sortedTags.filter((tag) => {
            const bookmarkCount = countIllusts(tag);
            return bookmarkCount < minBookmarks;
        });

        if (selectedTags.length === 0) {
            alert('No tag meet the criteria.');
            return;
        }

        // Show confirmation dialog
        const confirmation = confirm(
            `Are you sure you want to remove ${selectedTags.length} tags?`
        );
        if (!confirmation) return;

        removeTags(selectedTags);
    }
    
    async function fetchTokenPolyfill() {
        // get token
        const userRaw = await fetch(
            "/bookmark_add.php?type=illust&illust_id=83540927"
        );
        if (!userRaw.ok) {
            console.log(`获取身份信息失败
            Fail to fetch user information`);
            throw new Error();
        }
        const userRes = await userRaw.text();
        const tokenPos = userRes.indexOf("pixiv.context.token");
        const tokenEnd = userRes.indexOf(";", tokenPos);
        return userRes.slice(tokenPos, tokenEnd).split('"')[1];
    }
    async function initializeVariables() {
        async function polyfill() {
            try {
                const dataLayer = unsafeWindow_["dataLayer"][0];
                uid = dataLayer["user_id"];
                lang = dataLayer["lang"];
                token = await fetchTokenPolyfill();
                pageInfo.userId = window.location.href.match(/users\/(\d+)/)?.[1];
                pageInfo.client = { userId: uid, lang, token };
            } catch (err) {
                console.log(err);
                console.log("[Label Bookmarks] Initializing Failed");
            }
        }

        try {
            pageInfo = Object.values(document.querySelector(BANNER))[0]["return"][
                "return"
            ]["memoizedProps"];
            uid = pageInfo["client"]["userId"];
            token = pageInfo["client"]["token"];
            lang = pageInfo["client"]["lang"];
            if (!uid || !token || !lang) await polyfill();
        } catch (err) {
            console.log(err);
            await polyfill();
        }

    }
    async function fetchBookmarks(uid, tagToQuery='', offset=0, publicationType=null) {
        if (!publicationType){
            publicationType = window.location.href.includes("rest=hide") ? "hide" : "show";
        }
        const bookmarksRaw = await fetch(
            `/ajax/user/${uid}` +
            `/illusts/bookmarks?tag=${tagToQuery}` +
            `&offset=${offset}&limit=${bookmarkBatchSize}&rest=${publicationType}`
        );
        if (!turboMode) await delay(500);
        const bookmarksRes = await bookmarksRaw.json();
        if (!bookmarksRaw.ok || bookmarksRes.error === true) {
            return alert(
            `获取用户收藏夹列表失败\nFail to fetch user bookmarks\n` +
                decodeURI(bookmarksRes.message)
            );
        }
        const bookmarks = bookmarksRes.body;
        bookmarks.count = bookmarks["works"].length;
        const works = bookmarks["works"]
        .map((work) => {
            if (work.title === "-----") return null;
            work.bookmarkId = work["bookmarkData"]["id"];
            work.associatedTags = bookmarks["bookmarkTags"][work.bookmarkId] || []; 
            work.associatedTags = work.associatedTags.filter(
                (tag) => tag != "未分類"
            );
            return work;
        })
        .filter((work) => work && work.associatedTags.length); 
        bookmarks["works"] = works;
        return bookmarks;
    }

    async function fetchAllBookmarks(uid, tagToQuery='', publicationType=null){
        let total, // total bookmarks of specific tag
            index = 0; // counter of do-while loop
        let finalBookmarks = null;
        let allWorks = [];
        let allTags = {}
        do {
            const bookmarks = await fetchBookmarks(
                uid,
                tagToQuery,
                index,
                publicationType
            );
            if (!total) total = bookmarks.total;
            const works = bookmarks["works"];
            allWorks = allWorks.concat(works);
            allTags = updateObject(allTags, bookmarks["bookmarkTags"]);
            index += bookmarks.count || bookmarks["works"].length;
            finalBookmarks = updateObject(finalBookmarks, bookmarks);
            console.log(`Fetching bookmarks... ${index}/${total}`)
        } while (index < total);
        finalBookmarks["works"] = allWorks;
        finalBookmarks["bookmarkTags"] = allTags;
        return finalBookmarks;
    }

    // Function to count bookmarks by tag
    let tags = {};
    let sortedTags = [];
    let debounceTimer = null;
    let fetchedAll = false;

    // Function to check if the bookmarks list has changed
    const countIllusts = (tag) => Object.keys(tag.illustrations).length;
    const illustComparator = (a, b) => countIllusts(b) - countIllusts(a);

    function updateObject(target, source){
        if (!target) return source;
        //target = {...target, ...source};
        Object.assign(target, source);
        return target;
    }

    function saveTag(tag){
        if (!tags[tag]){
            userTags.push(tag);
            tags[tag] = {
                name: tag,
                illustrations: {},
            };
        }
        return tags[tag];
    }
    function saveIllust(tag, illust){
        tag = saveTag(tag);
        let illustId = illust.id;
        if (tag.illustrations[illustId]) {
            tag.illustrations[illustId] = updateObject(tag.illustrations[illustId], illust);
            illust = tag.illustrations[illustId];
        }else{
            tag.illustrations[illustId] = illust;
        }
        return illust;
    }

    async function summarizeAllBookmarks(){
        
        userTags = await fetchUserTags();
        userTags.forEach((tag) => {
            saveTag(tag);
        });

        const bookmarks = await fetchAllBookmarks(uid);
        console.log(`Fetched ${bookmarks.works.length} bookmarks`);
        
        let total = 0;
        bookmarks["works"].forEach((work) => {
            let illust = {
                id: work.id,
                title: work.title,
                alt: work.alt,
                img: work.url,
            };
            illust = updateObject(illust, work);
            illust["url"] = `https://www.pixiv.net/${lang}/artworks/${work.id}`;
            work.associatedTags.forEach((tag) => {
                saveIllust(tag, illust);
            });
            total += 1;
        });
        console.log(`Processed ${total} illusts with ${Object.keys(tags).length} tags`);
        sortedTags = Object.values(tags).sort(illustComparator);
        fetchedAll = true;
        requestAnimationFrame(renderSummary);
        //renderSummary();
    }


    // Function to render the summary UI
    function renderSummary() {
        let publicationType = window.location.href.includes("rest=hide") ? "hide" : "show";
        // Clear previous summary if exists
        const existingSummary = document.getElementById('tag-summary');
        if (existingSummary) {
            existingSummary.remove();
        }
        // Create a summary element
        const summaryDiv = document.createElement('div');
        summaryDiv.id = 'tag-summary'; // Set an ID for easy removal
        summaryDiv.style.position = 'fixed';
        summaryDiv.style.bottom = '10px';
        summaryDiv.style.right = '10px';
        summaryDiv.style.backgroundColor = '#fff';
        summaryDiv.style.padding = '10px';
        summaryDiv.style.border = '1px solid #ccc';
        summaryDiv.style.zIndex = '9999';

        const title = document.createElement('h3');
        title.innerText = 'Tags';
        title.style.cursor = 'pointer'; // Change cursor to pointer
        title.style.margin = '0'; // Remove default margin

        // Create a container for tag data
        const summaryContent = document.createElement('div');
        summaryContent.style.display = 'none'; // Initially hidden
        summaryContent.style.padding = '10px';
        summaryContent.style.maxHeight = '300px'; // Set a maximum height
        summaryContent.style.overflowY = 'auto'; // Enable vertical scrolling

        // Toggle visibility of the tag container when the title is clicked
        title.addEventListener('click', () => {
            if (summaryContent.style.display === 'none') {
                summaryContent.style.display = 'block';
                title.innerText = 'Tags'; // Change title when expanded
            } else {
                summaryContent.style.display = 'none';
                title.innerText = 'Tags'; // Reset title when collapsed
            }
        });

        let totalCount = 0;
        const tagContainer = document.createElement('div');
        tagContainer.style.display = 'grid';
        tagContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(100px, 1fr))';
        tagContainer.style.gap = '10px';
    
        // Keep track of the currently expanded tile
        let expandedTile = null;
        // Generate each tag as a tile with clickable illustration list
        Object.values(sortedTags).forEach((tag) => {
            let count = countIllusts(tag);
            if (!count) return;
    
            const tagTile = document.createElement('div');
            tagTile.style.backgroundColor = '#f0f0f0';
            tagTile.style.padding = '5px';
            tagTile.style.borderRadius = '5px';
            tagTile.style.textAlign = 'center';
            tagTile.style.cursor = 'pointer';
            tagTile.style.transition = 'all 0.3s ease';
    
            const tagText = document.createElement('div');
            const tagLink = document.createElement('a');
            tagLink.href = `https://www.pixiv.net/en/users/${uid}/bookmarks/artworks/${tag.name}?rest=${publicationType}`;
            tagLink.innerText = `${tag.name}`;
            tagLink.style.textDecoration = 'none';
            tagLink.style.color = 'black';
            tagLink.style.display = 'block';
            tagText.appendChild(tagLink);
    
            const tagCount = document.createElement('div');
            tagCount.innerText = `(${count})`;
            tagText.appendChild(tagCount);
    
            // Create a container for illustrations (initially hidden)
            const illustContainer = document.createElement('ol');
            illustContainer.classList.add("illust-container");
            illustContainer.style.display = 'none';
            illustContainer.style.paddingTop = '5px';
            illustContainer.style.textAlign = 'left';
    
            // Populate illustrations
            Object.values(tag.illustrations).forEach((illust) => {
                const illustItem = document.createElement('li');
                illustItem.style.marginBottom = '5px';
                illustItem.innerHTML = `<a href="${illust.url}" target="_blank">${illust.alt || illust.title}</a>`;
                illustContainer.appendChild(illustItem);
            });
    
            // Toggle illustration visibility when tile is clicked
            tagTile.addEventListener('click', () => {
                if (expandedTile && expandedTile !== tagTile) {
                    // Collapse the previously expanded tile
                    expandedTile.style.gridColumn = '';
                    expandedTile.querySelector('.illust-container').style.display = 'none';
                }
                if (illustContainer.style.display === 'none') {
                    // Expand this tile
                    tagTile.style.gridColumn = '1 / -1'; // Full width in grid
                    illustContainer.style.display = 'block';
                    expandedTile = tagTile;
                } else {
                    // Collapse this tile if already expanded
                    tagTile.style.gridColumn = '';
                    illustContainer.style.display = 'none';
                    expandedTile = null;
                }
            });

    
            tagTile.appendChild(tagText);
            tagTile.appendChild(illustContainer);  // Append hidden illustration container to each tile
            tagContainer.appendChild(tagTile);
            totalCount += count;
        });
        const totalContainer = document.createElement('p');
        totalContainer.innerHTML = `<span>Total: ${totalCount}</span>`;
        const logButton = document.createElement('button');
        logButton.innerHTML = `Log Items`;
        logButton.addEventListener('click', () => {
            console.log(JSON.stringify(sortedTags));
            console.log(sortedTags);
        });
        const fetchButton = document.createElement('button');
        fetchButton.innerHTML = `Fetch All`;
        fetchButton.addEventListener('click', () => {
            setTimeout(summarizeAllBookmarks, 100);
        });

        const bulkActionDiv = document.createElement('div');
        if (fetchedAll){
            // Create UI for bulk add/remove
            bulkActionDiv.style.marginTop = '10px';
            const minCountInput = document.createElement('input');
            minCountInput.type = 'number';
            minCountInput.placeholder = 'Min bookmarks';
            minCountInput.style.width = '100px';
            minCountInput.style.marginRight = '5px';
    
            // Remove button
            const removeButton = document.createElement('button');
            removeButton.innerText = 'Remove';
            removeButton.onclick = () => {
                const minBookmarks = parseInt(minCountInput.value, 10);
                if (isNaN(minBookmarks)) {
                    alert('Please enter a valid number for minimum bookmarks.');
                    return;
                }
                bulkRemove(minBookmarks);
            };
            // Append elements to the bulk action div
            bulkActionDiv.appendChild(minCountInput);
            bulkActionDiv.appendChild(removeButton);
        }

        summaryContent.appendChild(tagContainer);
        summaryContent.appendChild(totalContainer);
        summaryContent.appendChild(logButton);
        summaryContent.appendChild(fetchButton);
        // Add the bulk action div to the summary UI
        summaryContent.appendChild(bulkActionDiv);
        summaryDiv.appendChild(title);
        summaryDiv.appendChild(summaryContent);
        document.body.appendChild(summaryDiv);
    }

    // Initial summary calculation when the page loads
    window.addEventListener('load', () => {
        setTimeout(async () => {
            await initializeVariables();
            renderSummary();
        }, 1000);
    });

})();
