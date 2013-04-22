/*
This file is part of Ext JS 4.2

Copyright (c) 2011-2013 Sencha Inc

Contact:  http://www.sencha.com/contact

GNU General Public License Usage
This file may be used under the terms of the GNU General Public License version 3.0 as
published by the Free Software Foundation and appearing in the file LICENSE included in the
packaging of this file.

Please review the following information to ensure the GNU General Public License version 3.0
requirements will be met: http://www.gnu.org/copyleft/gpl.html.

If you are unsure which license is appropriate for your use, please contact the sales department
at http://www.sencha.com/contact.

Build date: 2013-03-11 22:33:40 (aed16176e68b5e8aa1433452b12805c0ad913836)
*/
/**
 * Implements buffered rendering of a grid, allowing users can scroll
 * through thousands of records without the performance penalties of
 * renderering all the records on screen at once.
 *
 * The number of rows rendered outside the visible area, and the
 * buffering of pages of data from the remote server for immediate
 * rendering upon scroll can be controlled by configuring the plugin.
 *
 * You can tell it to create a larger table to provide more scrolling
 * before new rows need to be added to the leading edge of the table.
 *
 *     var myStore = Ext.create('Ext.data.Store', {
 *         // ...
 *         pageSize: 100,
 *         // ...
 *     });
 *
 *     var grid = Ext.create('Ext.grid.Panel', {
 *         // ...
 *         autoLoad: true,
 *         plugins: {
 *             ptype: 'bufferedrenderer',
 *             trailingBufferZone: 20,  // Keep 20 rows rendered in the table behind scroll
 *             leadingBufferZone: 50   // Keep 50 rows rendered in the table ahead of scroll
 *         },
 *         // ...
 *     });
 *
 * ## Implementation notes
 *
 * This class monitors scrolling of the {@link Ext.view.Table
 * TableView} within a {@link Ext.grid.Panel GridPanel} to render a small section of
 * the dataset.
 *
 */
Ext.define('Ext.grid.plugin.BufferedRenderer', {
    extend: 'Ext.AbstractPlugin',
    requires: [
        'Ext.grid.plugin.BufferedRendererTableView',
        'Ext.grid.plugin.BufferedRendererTreeView'
    ],
    alias: 'plugin.bufferedrenderer',
    lockableScope: 'both',

    /**
     * @cfg {Number}
     * @deprecated This config is now ignored.
     */
    percentageFromEdge: 0.35,

    /**
     * @cfg {Boolean} [variableRowHeight=false]
     * Configure as `true` if the row heights are not all the same height as the first row. Only configure this is needed - this will be if the
     * rows contain unpredictably sized data, or you have changed the cell's text overflow stype to `'wrap'`.
     */
    variableRowHeight: false,

    /**
     * @cfg {Number}
     * The zone which causes new rows to be appended to the view. As soon as the edge
     * of the rendered grid is this number of rows from the edge of the viewport, the view is moved.
     */
    numFromEdge: 8,

    /**
     * @cfg {Number}
     * The number of extra rows to render on the trailing side of scrolling
     * **outside the {@link #numFromEdge}** buffer as scrolling proceeds.
     */
    trailingBufferZone: 10,

    /**
     * @cfg {Number}
     * The number of extra rows to render on the leading side of scrolling
     * **outside the {@link #numFromEdge}** buffer as scrolling proceeds.
     */
    leadingBufferZone: 20,

    /**
     * @cfg {Boolean} [synchronousRender=true]
     * By default, on detection of a scroll event which brings the end of the rendered table within
     * rows of the grid viewport, if the required rows are available in the Store,
     * the BufferedRenderer will render rows from the Store *immediately* before returning from the event handler. 
     * This setting helps avoid the impression of whitespace appearing during scrolling.
     *
     * Set this to `true` to defer the render until the scroll event handler exits. This allows for faster
     * scrolling, but also allows whitespace to be more easily scrolled into view.
     *
     */
    synchronousRender: true,

    /**
     * @cfg {Number}
     * This is the time in milliseconds to buffer load requests when scrolling the PagingScrollbar.
     */
    scrollToLoadBuffer: 200,

    // private. Initial value of zero.
    viewSize: 0,
    // private. Start at default value
    rowHeight: 21,
    // private. Table extent at startup time
    tableStart: 0,
    tableEnd: 0,
    /**
     * @property {Number} position
     * Current pixel scroll position of the associated {@link Ext.view.Table View}.
     */
    position: 0,
    lastScrollDirection: 1,
    bodyTop: 0,

    // Initialize this as a plugin
    init: function(grid) {
    	console.log('enter init..');
        var me = this,
            view = grid.view,
            viewListeners = {
                scroll: {
                    fn: me.onViewScroll,
                    element: 'el',
                    scope: me
                },
                boxready: me.onViewResize,
                resize: me.onViewResize,
                refresh: me.onViewRefresh,
                scope: me,
                destroyable: true
            };

        // If we are using default row heights, then do not sync row heights for efficiency
        if (!me.variableRowHeight && grid.ownerLockable) {
            grid.ownerLockable.syncRowHeight = false;
        }

        // If we are going to be handling a NodeStore then it's driven by node addition and removal, *not* refreshing.
        // The view overrides required above change the view's onAdd and onRemove behaviour to call onDataRefresh when necessary.
        if (grid.isTree || grid.ownerLockable && grid.ownerLockable.isTree) {
            view.blockRefresh = false;
            view.loadMask = true;
        }
        if (view.positionBody) {
            viewListeners.refresh = me.onViewRefresh;
        }
        me.grid = grid;
        me.view = view;
        view.bufferedRenderer = me;
        view.preserveScrollOnRefresh = true;

        me.bindStore(view.dataSource);
        view.getViewRange = function() {
            return me.getViewRange();
        };

        me.position = 0;

        me.gridListeners = grid.on('reconfigure', me.onReconfigure, me);
        me.viewListeners = view.on(viewListeners);
    },

    bindStore: function(store) {
    	console.log('enter bindStore..');    	
        var me = this;
        if (me.store) {
            me.unbindStore();
        }
        me.storeListeners = store.on({
            scope: me,
            clear: me.onStoreClear,
            destroyable: true
        });
        me.store = store;

        // If the view has acquired a size, calculate a new view size and scroll range when the store changes.
        if (me.view.componentLayout.layoutCount) {
            me.onViewResize(me.view, 0, me.view.getHeight());
        }
    },
    
    onReconfigure: function(grid, store){
    	onsole.log('enter onReconfigure..');
        if (store && store !== this.store) {
            this.bindStore(store);
        }
    },

    unbindStore: function() {
    	console.log('enter unbindStore..');
        this.storeListeners.destroy();
        delete this.view.getStoreListeners;
        this.store = null;
    },

    onStoreClear: function() {
    	console.log('enter onStoreClear..');
        var me = this;

        // Do not do anything if view is not rendered, or if the reason for cache clearing is store destruction
        if (me.view.rendered && !me.store.isDestroyed) {
            // Temporarily disable scroll monitoring until the scroll event caused by any following *change* of scrollTop has fired.
            // Otherwise it will attempt to process a scroll on a stale view
            if (me.scrollTop !== 0) {
                me.ignoreNextScrollEvent = true;
                me.view.el.dom.scrollTop = me.bodyTop = me.scrollTop = 0;
            }

            me.position = 0;
            delete me.lastScrollDirection;
            delete me.scrollOffset;
            delete me.rowHeight;
        }
    },

    onViewRefresh: function() {
    	console.log('enter onViewRefresh..');
        var me = this,
            view = me.view;
        
        if (me.scrollTop !== view.el.dom.scrollTop) {
            // The view may have refreshed and scrolled to the top, for example
            // on a sort. If so, it's as if we scrolled to the top, so we'll simulate
            // it here.
            me.onViewScroll();    
        } else {
            me.setBodyTop(me.bodyTop);
            if (view.all.getCount()) {
                me.viewSize = 0;
                me.onViewResize(view, null, view.getHeight());
            }
        }
    },

    onViewResize: function(view, width, height, oldWidth, oldHeight) {
    	console.log('enter onViewResize..');
        // Only process first layout (the boxready event) or height resizes.
        if (!oldHeight || height !== oldHeight) {
            var me = this,
                newViewSize,
                scrollRange;

            // View has rows, delete the rowHeight property to trigger a recalculation when scrollRange is calculated
            if (view.all.getCount()) {
                // We need to calculate the table size based upon the new viewport size and current row height
                delete me.rowHeight;
            }
            // If no rows, continue to use the same rowHeight, and the refresh handler will call this again.

            // Calculates scroll range. Also calculates rowHeight if we do not have an own rowHeight property.
            // That will be the case if the view contains some rows.
            scrollRange = me.getScrollHeight();
            newViewSize = Math.ceil(height / me.rowHeight) + me.trailingBufferZone + me.leadingBufferZone;
            me.viewSize = me.setViewSize(newViewSize);
            me.stretchView(view, scrollRange);
        }
    },
 
    stretchView: function(view, scrollRange) {
    	console.log('enter stretchView..');
        var me = this,
            recordCount = (me.store.buffered ? me.store.getTotalCount() : me.store.getCount());

        if (me.stretcher) {
            me.stretcher.dom.style.marginTop = (scrollRange - 1) + 'px';
        } else {
            var el = view.el;

            // If the view has already been refreshed by the time we get here (eg, the grid, has undergone a reconfigure operation - which performs a refresh),
            // keep it informed of fixed nodes which it must leave alone on refresh.
            if (view.refreshCounter) {
                view.fixedNodes++;
            }

            // If this is the last page, correct the scroll range to be just enough to fit.
            if (recordCount && (me.view.all.endIndex === recordCount - 1)) {
                scrollRange = me.bodyTop + view.body.dom.offsetHeight;
            }
            this.stretcher = el.createChild({
                style: {
                    width: '1px',
                    height: '1px',
                    'marginTop': (scrollRange - 1) + 'px',
                    left: 0,
                    position: 'absolute'
                }
            }, el.dom.firstChild);
        }
    },

    setViewSize: function(viewSize) {
    	console.log('enter setViewSize..');
        if (viewSize !== this.viewSize) {

            // Must be set for getFirstVisibleRowIndex to work
            this.scrollTop = this.view.el.dom.scrollTop;

            var me = this,
                store = me.store,
                elCount = me.view.all.getCount(),
                start, end;

            me.viewSize = store.viewSize = viewSize;

            // If a store loads before we have calculated a viewSize, it loads me.defaultViewSize records.
            // This may be larger or smaller than the final viewSize so the store needs adjusting when the view size is calculated.
            if (elCount) {
                start = me.view.all.startIndex;
                end = Math.min(start + viewSize - 1, (store.buffered ? store.getTotalCount() : store.getCount()) - 1);
                me.renderRange(start, end);
            }
        }
        return viewSize;
    },

    getViewRange: function() {
    	console.log('enter getViewRange..');
        var me = this,
            rows = me.view.all,
            store = me.store;

        if (store.data.getCount()) {
            return store.getRange(rows.startIndex, rows.startIndex + (me.viewSize || me.store.defaultViewSize) - 1);
        } else {
            return [];
        }
    },

    /**
     * Scrolls to and optionlly selects the specified row index **in the total dataset**.
     * 
     * @param {Number} recordIdx The zero-based position in the dataset to scroll to.
     * @param {Boolean} doSelect Pass as `true` to select the specified row.
     * @param {Function} callback A function to call when the row has been scrolled to.
     * @param {Number} callback.recordIdx The resulting record index (may have changed if the passed index was outside the valid range).
     * @param {Ext.data.Model} callback.record The resulting record from the store.
     * @param {Object} scope The scope (`this` reference) in which to execute the callback. Defaults to this BufferedRenderer.
     * 
     */
    scrollTo: function(recordIdx, doSelect, callback, scope) {
    	console.log('enter scrollTo..');
        var me = this,
            view = me.view,
            viewDom = view.el.dom,
            store = me.store,
            total = store.buffered ? store.getTotalCount() : store.getCount(),
            startIdx, endIdx,
            targetRec,
            targetRow,
            tableTop;

        // Sanitize the requested record
        recordIdx = Math.min(Math.max(recordIdx, 0), total - 1);

        // Calculate view start index
        startIdx = Math.max(Math.min(recordIdx - ((me.leadingBufferZone + me.trailingBufferZone) / 2), total - me.viewSize + 1), 0);
        tableTop = startIdx * me.rowHeight;
        endIdx = Math.min(startIdx + me.viewSize - 1, total - 1);

        store.getRange(startIdx, endIdx, {
            callback: function(range, start, end) {

                me.renderRange(start, end, true);

                targetRec = store.data.getRange(recordIdx, recordIdx)[0];
                targetRow = view.getNode(targetRec, false);
                view.body.dom.style.top = tableTop + 'px';
                me.position = me.scrollTop = viewDom.scrollTop = tableTop = Math.min(Math.max(0, tableTop - view.body.getOffsetsTo(targetRow)[1]), viewDom.scrollHeight - viewDom.clientHeight);

                // https://sencha.jira.com/browse/EXTJSIV-7166 IE 6, 7 and 8 won't scroll all the way down first time
                if (Ext.isIE) {
                    viewDom.scrollTop = tableTop;
                }
                if (doSelect) {
                    view.selModel.select(targetRec);
                }
                if (callback) {
                    callback.call(scope||me, recordIdx, targetRec);
                }
            }
        });
    },

    onViewScroll: function(e, t) {
    	console.log('------enter onViewScroll----..');
        var me = this,
            vscrollDistance, //两次移动距离
            scrollDirection, //滑动方向，1向下滑动，-1向上滑动
            scrollTop = me.view.el.dom.scrollTop;

        // Flag set when the scrollTop is programatically set to zero upon cache clear.
        // We must not attempt to process that as a scroll event.
        if (me.ignoreNextScrollEvent) {
            me.ignoreNextScrollEvent = false;
            return;
        }

        // Only check for nearing the edge if we are enabled.
        // If there is no paging to be done (Store's dataset is all in memory) we will be disabled.
        if (!me.disabled) {

            vscrollDistance = scrollTop - me.position;
            scrollDirection = vscrollDistance > 0 ? 1 : -1;
            me.scrollTop = scrollTop;
            
            //当滑动超过20px，或者移动方向改变时
            // Moved at leat 20 pixels, or cvhanged direction, so test whether the numFromEdge is triggered
            if (Math.abs(vscrollDistance) >= 20 || (scrollDirection !== me.lastScrollDirection)) {
            	//position为上次滚动条位置
                me.position = scrollTop;
                //上次滑动方向
                me.lastScrollDirection = scrollDirection;
                //处理滑动，传入滑动方向
                me.handleViewScroll(me.lastScrollDirection);
            }
        }
    },

    handleViewScroll: function(direction) {
    	console.log('----enter handleViewScroll-----..');
        var me                = this,
            rows              = me.view.all, //table 中存在的所有行的对象， NodeCache
            store             = me.store,
            viewSize          = me.viewSize, //table中行数
            totalCount        = (store.buffered ? store.getTotalCount() : store.getCount()), //总记录数
            requestStart,
            requestEnd;

        // Only process if the total rows is larger than the visible page size
        //大于一页
        if (totalCount >= viewSize) {

            // We're scrolling up
        	//向上滑
            if (direction == -1) {

                // If table starts at record zero, we have nothing to do
                if (rows.startIndex) {
                    if ((me.getFirstVisibleRowIndex() - rows.startIndex) < me.numFromEdge) {
                        requestStart = Math.max(0, me.getLastVisibleRowIndex() + me.trailingBufferZone - viewSize);
                    }
                }
            }
            // We're scrolling down
            //向下滑
            else {

                // If table ends at last record, we have nothing to do
            	//table中最后一行不为总记录最后一行
            	//rows.startIndex :table中第一行在总记录中的index
            	//rows.endIndex : table中最后一行在总记录中的index
                if (rows.endIndex < totalCount - 1) {
                	//table的最后一行与可视view的最后一行相差小于numFromEdge时
                    if ((rows.endIndex - me.getLastVisibleRowIndex()) < me.numFromEdge) {
                        requestStart = Math.max(0, me.getFirstVisibleRowIndex() - me.trailingBufferZone);
                    }
                }
            }

            // We scrolled close to the edge and the Store needs reloading
            if (requestStart !== undefined) {
                requestEnd = Math.min(requestStart + viewSize - 1, totalCount - 1);

                // If calculated view range has moved, then render it
                if (requestStart !== rows.startIndex || requestEnd !== rows.endIndex) {
                    me.renderRange(requestStart, requestEnd);
                }
            }
        }
    },

    renderRange: function(start, end, forceSynchronous) {
    	console.log('enter renderRange..');
        var me = this,
            store = me.store;

        // If range is avaliable synchronously, process it now.
        if (store.rangeCached(start, end)) {
            me.cancelLoad();

            if (me.synchronousRender || forceSynchronous) {
                me.onRangeFetched(null, start, end);
            } else {
                if (!me.renderTask) {
                    me.renderTask = new Ext.util.DelayedTask(me.onRangeFetched, me, null, false);
                }
                // Render the new range very soon after this scroll event handler exits.
                // If scrolling very quickly, a few more scroll events may fire before
                // the render takes place. Each one will just *update* the arguments with which
                // the pending invocation is called.
                me.renderTask.delay(1, null, null, [null, start, end]);
            }
        }

        // Required range is not in the prefetch buffer. Ask the store to prefetch it.
        else {
            me.attemptLoad(start, end);
        }
    },

    onRangeFetched: function(range, start, end) {
    	console.log('enter onRangeFetched..');
        var me = this,
            view = me.view,
            oldStart,
            rows = view.all,
            removeCount,
            increment = 0,
            calculatedTop = start * me.rowHeight,
            top;

        // View may have been destroyed since the DelayedTask was kicked off.
        if (view.isDestroyed) {
            return;
        }

        // If called as a callback from the Store, the range will be passed, if called from renderRange, it won't
        if (!range) {
            range = me.store.getRange(start, end);

            // Store may have been cleared since the DelayedTask was kicked off.
            if (!range) {
                return;
            }
        }

        // No overlapping nodes, we'll need to render the whole range
        if (start > rows.endIndex || end < rows.startIndex) {
            rows.clear(true);
            top = calculatedTop;
        }

        if (!rows.getCount()) {
            view.doAdd(range, start);
        }
        // Moved down the dataset (content moved up): remove rows from top, add to end
        else if (end > rows.endIndex) {
            removeCount = Math.max(start - rows.startIndex, 0);

            // We only have to bump the table down by the height of removed rows if rows are not a standard size
            if (me.variableRowHeight) {
                increment = rows.item(rows.startIndex + removeCount, true).offsetTop;
            }
            rows.scroll(Ext.Array.slice(range, rows.endIndex + 1 - start), 1, removeCount, start, end);

            // We only have to bump the table down by the height of removed rows if rows are not a standard size
            if (me.variableRowHeight) {
                // Bump the table downwards by the height scraped off the top
                top = me.bodyTop + increment;
            } else {
                top = calculatedTop;
            }
        }
        // Moved up the dataset: remove rows from end, add to top
        else {
            removeCount = Math.max(rows.endIndex - end, 0);
            oldStart = rows.startIndex;
            rows.scroll(Ext.Array.slice(range, 0, rows.startIndex - start), -1, removeCount, start, end);

            // We only have to bump the table up by the height of top-added rows if rows are not a standard size
            if (me.variableRowHeight) {
                // Bump the table upwards by the height added to the top
                top = me.bodyTop - rows.item(oldStart, true).offsetTop;
            } else {
                top = calculatedTop;
            }
        }

        // Position the table element. top will be undefined if fixed row height, so table position will
        // be calculated.
        if (view.positionBody) {
            me.setBodyTop(top, calculatedTop);
        }
    },

    setBodyTop: function(bodyTop, calculatedTop) {
    	console.log('enter setBodyTop..');
        var me = this,
            view = me.view,
            store = me.store,
            body = view.body.dom,
            delta;

        bodyTop = Math.floor(bodyTop);

        // See if there's a difference between the calculated top and the requested top.
        // This can be caused by non-standard row heights introduced by features or non-standard
        // data in rows.
        if (calculatedTop !== undefined) {
            delta = bodyTop - calculatedTop;
            bodyTop = calculatedTop;
        }
        body.style.position = 'absolute';
        body.style.top = (me.bodyTop = bodyTop) + 'px';

        // Adjust scrollTop to keep user-perceived position the same in the case of the calculated position not matching where the actual position was.
        // Set position property so that scroll handler does not fire in response.
        if (delta) {
            me.scrollTop = me.position = view.el.dom.scrollTop -= delta;
        }

        // If this is the last page, correct the scroll range to be just enough to fit.
        if (me.view.all.endIndex === (store.buffered ? store.getTotalCount() : store.getCount()) - 1) {
            me.stretchView(view, me.bodyTop + body.offsetHeight);
        }
    },

    getFirstVisibleRowIndex: function(startRow, endRow, viewportTop, viewportBottom) {
       console.log('-----enter getFirstVisibleRowIndex------');
    	var me = this,
            view = me.view,
            rows = view.all,
            elements = rows.elements,
            clientHeight = view.el.dom.clientHeight,
            target,
            targetTop;

        // If variableRowHeight, we have to search for the first row who's bottom edge is within the viewport
        if (rows.getCount() && me.variableRowHeight) {
            if (!arguments.length) {
                startRow = rows.startIndex;
                endRow = rows.endIndex;
                viewportTop = me.scrollTop;
                viewportBottom = viewportTop + clientHeight;

                // Teleported so that body is outside viewport: Use rowHeight calculation
                if (me.bodyTop > viewportBottom || me.bodyTop + view.body.getHeight() < viewportTop) {
                    return Math.floor(me.scrollTop / me.rowHeight);
                }

                // In first, non-recursive call, begin targetting the most likely first row
                target = startRow + Math.min(me.numFromEdge + ((me.lastScrollDirection == -1) ? me.leadingBufferZone : me.trailingBufferZone), Math.floor((endRow - startRow) / 2));
            } else {
                target = startRow + Math.floor((endRow - startRow) / 2);
            }
            targetTop = me.bodyTop + elements[target].offsetTop;

            // If target is entirely above the viewport, chop downwards
            if (targetTop + elements[target].offsetHeight < viewportTop) {
                return me.getFirstVisibleRowIndex(target + 1, endRow, viewportTop, viewportBottom);
            }
            
            // Target is first
            if (targetTop <= viewportTop) {
                return target;
            }
            // Not narrowed down to 1 yet; chop upwards
            else if (target !== startRow) {
                return me.getFirstVisibleRowIndex(startRow, target - 1, viewportTop, viewportBottom);
            }
        }
        return Math.floor(me.scrollTop / me.rowHeight);
    },

    getLastVisibleRowIndex: function(startRow, endRow, viewportTop, viewportBottom) {
        console.log('------enter getLastVisibleRowIndex------..');
        var me = this,
            view = me.view,
            rows = view.all,
            elements = rows.elements,
            clientHeight = view.el.dom.clientHeight,
            target,
            targetTop, targetBottom;

        // If variableRowHeight, we have to search for the first row who's bottom edge is below the bottom of the viewport
        if (rows.getCount() && me.variableRowHeight) {
            if (!arguments.length) {
                startRow = rows.startIndex;
                endRow = rows.endIndex;
                viewportTop = me.scrollTop;
                viewportBottom = viewportTop + clientHeight;

                // Teleported so that body is outside viewport: Use rowHeight calculation
                if (me.bodyTop > viewportBottom || me.bodyTop + view.body.getHeight() < viewportTop) {
                    return Math.floor(me.scrollTop / me.rowHeight) + Math.ceil(clientHeight / me.rowHeight);
                }

                // In first, non-recursive call, begin targetting the most likely last row
                target = endRow - Math.min(me.numFromEdge + ((me.lastScrollDirection == 1) ? me.leadingBufferZone : me.trailingBufferZone), Math.floor((endRow - startRow) / 2));
            } else {
                target = startRow + Math.floor((endRow - startRow) / 2);
            }
            targetTop = me.bodyTop + elements[target].offsetTop;

            // If target is entirely below the viewport, chop upwards
            if (targetTop > viewportBottom) {
                return me.getLastVisibleRowIndex(startRow, target - 1, viewportTop, viewportBottom);
            }
            targetBottom = targetTop + elements[target].offsetHeight;

            // Target is last
            if (targetBottom >= viewportBottom) {
                return target;
            }
            // Not narrowed down to 1 yet; chop downwards
            else if (target !== endRow) {
                return me.getLastVisibleRowIndex(target + 1, endRow, viewportTop, viewportBottom);
            }
        }
        return me.getFirstVisibleRowIndex() + Math.ceil(clientHeight / me.rowHeight);
    },

    getScrollHeight: function() {
    	console.log('enter getScrollHeight..');
        var me = this,
            view   = me.view,
            store  = me.store,
            doCalcHeight = !me.hasOwnProperty('rowHeight'),
            storeCount = me.store.getCount();

        if (!storeCount) {
            return 0;
        }
        if (doCalcHeight) {
            if (view.all.getCount()) {
                me.rowHeight = Math.floor(view.body.getHeight() / view.all.getCount());
            }
        }
        return Math.floor((store.buffered ? store.getTotalCount() : store.getCount()) * me.rowHeight);
    },

    attemptLoad: function(start, end) {
    	console.log('enter attemptLoad..');
        var me = this;
        if (me.scrollToLoadBuffer) {
            if (!me.loadTask) {
                me.loadTask = new Ext.util.DelayedTask(me.doAttemptLoad, me, []);
            }
            me.loadTask.delay(me.scrollToLoadBuffer, me.doAttemptLoad, me, [start, end]);
        } else {
            me.store.getRange(start, end, {
                callback: me.onRangeFetched,
                scope: me,
                fireEvent: false
            });
        }
    },

    cancelLoad: function() {
    	console.log('enter cancelLoad.');
        if (this.loadTask) {
            this.loadTask.cancel();
        }
    },

    doAttemptLoad:  function(start, end) {
    	console.log('enter doAttemptLoad..');
        this.store.getRange(start, end, {
            callback: this.onRangeFetched,
            scope: this,
            fireEvent: false
        });
    },

    destroy: function() {
    	console.log('enter destroy..');
        var me = this,
            view = me.view;

        if (view && view.el) {
            view.el.un('scroll', me.onViewScroll, me); // un does not understand the element options
        }

        // Remove listeners from old grid, view and store
        Ext.destroy(me.viewListeners, me.storeListeners, me.gridListeners);
    }
});
