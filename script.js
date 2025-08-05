/**
 * マインドマップアプリ - メインJavaScript
 * MindMeisterライクな操作感を実現
 */

class MindMapApp {
    constructor() {
        this.nodes = new Map(); // ノードのデータを管理
        this.selectedNode = null; // 現在選択されているノード
        this.editingNode = null; // 現在編集中のノード
        this.nodeCounter = 0; // ノードのユニークID生成用
        this.dragState = null; // ドラッグ状態の管理
        
        // Undo機能のための履歴管理
        this.history = [];
        this.maxHistorySize = 50;
        
        // ビューポート管理
        this.viewport = {
            x: 0,
            y: 0,
            scale: 1
        };
        
        // DOM要素の取得
        this.container = document.getElementById('mindmap-container');
        this.nodesContainer = document.getElementById('nodes-container');
        this.svg = document.getElementById('mindmap-svg');
        this.connectionsGroup = document.getElementById('connections');
        this.undoBtn = document.getElementById('undo-btn');
        this.colorMenu = document.getElementById('color-menu');
        
        // 色変更関連
        this.currentColorNode = null;
        
        this.init();
    }

    /**
     * アプリケーションの初期化
     */
    init() {
        console.log('マインドマップアプリ初期化開始');
        this.setupEventListeners();
        
        // 保存されたデータを読み込み、なければルートノードを作成
        if (!this.loadFromDatabase()) {
            this.createRootNode();
        }
        
        // 初期化完了後に少し遅延してレイアウトと接続線を更新
        setTimeout(() => {
            this.updateLayout();
            this.updateConnections();
            console.log('初期化完了 - レイアウトと接続線を更新');
            
            // 自動保存機能を開始
            this.autoSave();
        }, 100);
    }

    /**
     * イベントリスナーの設定
     */
    setupEventListeners() {
        // キーボードイベント
        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // コンテナクリックでノード選択解除
        this.container.addEventListener('click', (e) => {
            if (e.target === this.container || e.target === this.nodesContainer) {
                this.selectNode(null);
            }
        });

        // ウィンドウリサイズ時のレイアウト更新
        window.addEventListener('resize', () => this.updateLayout());
        
        // Undoボタンのイベントリスナー
        this.undoBtn.addEventListener('click', () => this.undo());
        
        // 色変更メニューのイベントリスナー
        this.setupColorMenu();
        
        // スクロール・パン機能の設定
        this.setupPanAndZoom();
    }

    /**
     * ルートノードの作成
     */
    createRootNode() {
        const rootData = {
            id: this.generateId(),
            text: 'メインアイデア',
            level: 0,
            parent: null,
            children: [],
            x: 0, // 中心を原点とする
            y: 0,
            color: null // ルートノードはデフォルト色
        };

        this.nodes.set(rootData.id, rootData);
        this.createNodeElement(rootData);
        this.selectNode(rootData.id);
    }

    /**
     * ノードのDOM要素を作成
     */
    createNodeElement(nodeData) {
        const nodeElement = document.createElement('div');
        nodeElement.className = `node level-${nodeData.level}`;
        if (nodeData.level === 0) nodeElement.classList.add('root');
        
        // 色を適用
        if (nodeData.color && nodeData.level > 0) {
            nodeElement.classList.add(`color-${nodeData.color}`);
        }
        
        nodeElement.dataset.nodeId = nodeData.id;
        nodeElement.textContent = nodeData.text;
        
        // 位置設定（ビューポート座標系で）
        this.updateNodePosition(nodeElement, nodeData);
        
        // イベントリスナー
        nodeElement.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectNode(nodeData.id);
        });
        
        nodeElement.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this.startEditing(nodeData.id);
        });
        
        // 右クリック/2本指タップで色変更メニュー
        nodeElement.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (nodeData.level > 0) { // ルートノード以外のみ
                this.showColorMenu(e.clientX, e.clientY, nodeData.id);
            }
        });

        // ドラッグ機能
        this.setupDragHandlers(nodeElement, nodeData);
        
        // アニメーション（Undo時は適用しない）
        if (!this.isUndoing) {
            nodeElement.classList.add('appear');
        }
        
        this.nodesContainer.appendChild(nodeElement);
        return nodeElement;
    }

    /**
     * ドラッグ機能の設定
     */
    setupDragHandlers(element, nodeData) {
        let isDragging = false;
        let startX, startY, startNodeX, startNodeY;

        element.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            startNodeX = nodeData.x;
            startNodeY = nodeData.y;
            
            element.classList.add('dragging');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
            
            e.preventDefault();
        });

        const onMouseMove = (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            nodeData.x = startNodeX + deltaX / this.viewport.scale;
            nodeData.y = startNodeY + deltaY / this.viewport.scale;
            
            this.updateNodePosition(element, nodeData);
            
            this.updateConnections();
        };

        const onMouseUp = () => {
            if (isDragging) {
                isDragging = false;
                element.classList.remove('dragging');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        };
    }

    /**
     * ノードの選択
     */
    selectNode(nodeId) {
        // 前の選択を解除
        if (this.selectedNode) {
            const prevElement = this.getNodeElement(this.selectedNode);
            if (prevElement) prevElement.classList.remove('selected');
        }

        this.selectedNode = nodeId;
        
        if (nodeId) {
            const element = this.getNodeElement(nodeId);
            if (element) element.classList.add('selected');
        }
    }

    /**
     * ノードの編集開始
     */
    startEditing(nodeId) {
        if (this.editingNode) this.stopEditing();
        
        this.editingNode = nodeId;
        const nodeData = this.nodes.get(nodeId);
        const element = this.getNodeElement(nodeId);
        
        if (!element || !nodeData) return;
        
        element.classList.add('editing');
        
        // テキスト入力要素を作成
        const input = document.createElement('textarea');
        input.className = 'node-input';
        input.value = nodeData.text;
        input.rows = 1;
        
        // 既存のテキストを隠す
        element.textContent = '';
        element.appendChild(input);
        
        // フォーカスして選択
        input.focus();
        input.select();
        
        // イベントリスナー
        input.addEventListener('blur', () => this.stopEditing());
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.stopEditing();
            }
            if (e.key === 'Escape') {
                input.value = nodeData.text; // 元に戻す
                this.stopEditing();
            }
        });

        // 自動リサイズ
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = input.scrollHeight + 'px';
        });
    }

    /**
     * ノードの編集終了
     */
    stopEditing() {
        if (!this.editingNode) return;
        
        const nodeData = this.nodes.get(this.editingNode);
        const element = this.getNodeElement(this.editingNode);
        const input = element.querySelector('.node-input');
        
        if (input && nodeData) {
            nodeData.text = input.value.trim() || 'ノード';
            element.textContent = nodeData.text;
            
            // テキスト変更時に保存
            this.saveToDatabase();
        }
        
        element.classList.remove('editing');
        this.editingNode = null;
    }

    /**
     * キーボードイベントの処理
     */
    handleKeyDown(e) {
        // Cmd+Z (Mac) または Ctrl+Z (Windows) でUndo
        if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
            e.preventDefault();
            this.undo();
            return;
        }
        
        if (!this.selectedNode || this.editingNode) return;
        
        switch (e.key) {
            case 'Enter':
                e.preventDefault();
                this.addSiblingNode();
                break;
            case 'Tab':
                e.preventDefault();
                this.addChildNode();
                break;
            case 'F2':
                e.preventDefault();
                this.startEditing(this.selectedNode);
                break;
            case 'Delete':
            case 'Backspace':
                e.preventDefault();
                this.deleteNode(this.selectedNode);
                break;
        }
    }

    /**
     * 兄弟ノードの追加
     */
    addSiblingNode() {
        const currentNode = this.nodes.get(this.selectedNode);
        if (!currentNode || currentNode.level === 0) return; // ルートノードには兄弟を追加できない
        
        const parentNode = this.nodes.get(currentNode.parent);
        if (!parentNode) return;
        
        // 履歴に保存
        this.saveToHistory();
        
        const newNodeData = {
            id: this.generateId(),
            text: 'ノード',
            level: currentNode.level,
            parent: parentNode.id,
            children: [],
            x: currentNode.x,
            y: currentNode.y,
            color: 'white' // デフォルトは白
        };
        
        this.nodes.set(newNodeData.id, newNodeData);
        parentNode.children.push(newNodeData.id);
        
        this.createNodeElement(newNodeData);
        this.selectNode(newNodeData.id);
        
        // レイアウトと接続線を確実に更新
        setTimeout(() => {
            this.updateLayout();
            this.updateConnections();
            this.saveToDatabase(); // ノード追加時に保存
            console.log('兄弟ノード追加後の接続線更新完了');
        }, 50);
        
        // 新しいノードを編集モードに
        setTimeout(() => this.startEditing(newNodeData.id), 150);
    }

    /**
     * 子ノードの追加
     */
    addChildNode() {
        const parentNode = this.nodes.get(this.selectedNode);
        if (!parentNode) return;
        
        // 履歴に保存
        this.saveToHistory();
        
        const newNodeData = {
            id: this.generateId(),
            text: 'ノード',
            level: parentNode.level + 1,
            parent: parentNode.id,
            children: [],
            x: parentNode.x,
            y: parentNode.y,
            color: 'white' // デフォルトは白
        };
        
        this.nodes.set(newNodeData.id, newNodeData);
        parentNode.children.push(newNodeData.id);
        
        this.createNodeElement(newNodeData);
        this.selectNode(newNodeData.id);
        
        // レイアウトと接続線を確実に更新
        setTimeout(() => {
            this.updateLayout();
            this.updateConnections();
            this.saveToDatabase(); // ノード追加時に保存
            console.log('子ノード追加後の接続線更新完了');
        }, 50);
        
        // 新しいノードを編集モードに
        setTimeout(() => this.startEditing(newNodeData.id), 150);
    }

    /**
     * ノードの削除
     */
    deleteNode(nodeId) {
        const nodeData = this.nodes.get(nodeId);
        if (!nodeData || nodeData.level === 0) return; // ルートノードは削除できない
        
        // 履歴に保存
        this.saveToHistory();
        
        // 子ノードも再帰的に削除
        nodeData.children.forEach(childId => this.deleteNode(childId));
        
        // 親ノードから削除
        if (nodeData.parent) {
            const parentNode = this.nodes.get(nodeData.parent);
            if (parentNode) {
                parentNode.children = parentNode.children.filter(id => id !== nodeId);
            }
        }
        
        // DOM要素を削除
        const element = this.getNodeElement(nodeId);
        if (element) element.remove();
        
        // データから削除
        this.nodes.delete(nodeId);
        
        // 選択を解除
        if (this.selectedNode === nodeId) {
            this.selectNode(nodeData.parent);
        }
        
        this.updateConnections();
        this.saveToDatabase(); // ノード削除時に保存
    }

    /**
     * レイアウトの更新（MindMeister風自動配置）- 完全重なり防止版
     */
    updateLayout() {
        const rootNode = Array.from(this.nodes.values()).find(node => node.level === 0);
        if (!rootNode) return;
        
        // ルートノードは原点に固定
        rootNode.x = 0;
        rootNode.y = 0;
        
        // 段階的レイアウト実行
        this.layoutChildrenMindMeisterStyle(rootNode);
        
        // 全ノードの重なりを厳重にチェック・調整
        this.performComprehensiveOverlapResolution();
        
        this.updateNodePositions();
        this.updateConnections();
    }

    /**
     * 美しい整列レイアウトアルゴリズム（MindMeister風、線が交差しない）
     */
    layoutChildrenMindMeisterStyle(parentNode) {
        const children = parentNode.children.map(id => this.nodes.get(id)).filter(Boolean);
        if (children.length === 0) return;
        
        if (parentNode.level === 0) {
            // ルートノードの子は左右に分散配置
            this.layoutRootChildren(parentNode, children);
        } else {
            // その他のノードは交差しない配置
            this.layoutBranchChildrenNoIntersection(parentNode, children);
        }
        
        // 再帰的に子ノードの配置を計算
        children.forEach(child => this.layoutChildrenMindMeisterStyle(child));
    }
    
    /**
     * ルートノードの子ノード配置（左右分散）
     */
    layoutRootChildren(rootNode, children) {
        const baseDistance = 320;
        const minVerticalSpacing = 120;
        
        // ノードの高さを考慮した動的間隔計算
        const nodeHeight = 60; // より大きなノード高さを想定
        const verticalSpacing = Math.max(minVerticalSpacing, nodeHeight + 40);
        
        // 左右に分散配置（より大きな間隔で）
        const leftNodes = [];
        const rightNodes = [];
        
        children.forEach((child, index) => {
            if (index % 2 === 0) {
                rightNodes.push(child);
            } else {
                leftNodes.push(child);
            }
        });
        
        // 右側ノードの配置
        rightNodes.forEach((child, index) => {
            child.x = baseDistance;
            child.y = (index - (rightNodes.length - 1) / 2) * verticalSpacing;
        });
        
        // 左側ノードの配置
        leftNodes.forEach((child, index) => {
            child.x = -baseDistance;
            child.y = (index - (leftNodes.length - 1) / 2) * verticalSpacing;
        });
    }
    
    /**
     * 美しい整列配置（画像2のようなスタイル）
     */
    layoutBranchChildrenAligned(parentNode, children) {
        const baseDistance = 250;
        const minVerticalSpacing = 100;
        
        // ノードの高さを考慮した動的間隔計算
        const nodeHeight = 60; // より大きなノード高さを想定
        const verticalSpacing = Math.max(minVerticalSpacing, nodeHeight + 30);
        
        // 親ノードからの方向を決定
        let direction = 1; // 右側がデフォルト
        if (parentNode.parent) {
            const grandParent = this.nodes.get(parentNode.parent);
            if (grandParent) {
                // 親ノードが左側にある場合は右側に、右側にある場合は左側に配置
                direction = parentNode.x > grandParent.x ? 1 : -1;
            }
        }
        
        // 子ノードを縦に整列して配置（十分な間隔で）
        const totalHeight = (children.length - 1) * verticalSpacing;
        const startY = parentNode.y - totalHeight / 2;
        
        children.forEach((child, index) => {
            child.x = parentNode.x + (baseDistance * direction);
            child.y = startY + (index * verticalSpacing);
        });
        
        // 重なり検出と調整（より強力に）
        this.adjustOverlappingNodesAdvanced(children);
    }
    
    /**
     * 線が交差しないブランチレイアウト（MindMeister風）
     */
    layoutBranchChildrenNoIntersection(parentNode, children) {
        const baseDistance = 280;
        const minVerticalSpacing = 120;
        
        // 親ノードからの方向を決定
        let direction = 1; // 右側がデフォルト
        if (parentNode.parent) {
            const grandParent = this.nodes.get(parentNode.parent);
            if (grandParent) {
                direction = parentNode.x > grandParent.x ? 1 : -1;
            }
        }
        
        // 兄弟ノードの子ノードとの衝突を防ぐためのスペース計算
        const requiredSpace = this.calculateRequiredSpace(parentNode, children.length);
        const verticalSpacing = Math.max(minVerticalSpacing, requiredSpace / Math.max(children.length - 1, 1));
        
        // 子ノードを配置
        const totalHeight = (children.length - 1) * verticalSpacing;
        const startY = parentNode.y - totalHeight / 2;
        
        children.forEach((child, index) => {
            child.x = parentNode.x + (baseDistance * direction);
            child.y = startY + (index * verticalSpacing);
        });
        
        // 交差を防ぐための追加調整
        this.avoidIntersections(parentNode, children);
    }
    
    /**
     * 必要なスペースを計算（兄弟ノードとの衝突を防ぐ）
     */
    calculateRequiredSpace(parentNode, childrenCount) {
        if (!parentNode.parent) return 200; // ルートノードの子の場合
        
        const grandParent = this.nodes.get(parentNode.parent);
        if (!grandParent) return 200;
        
        // 兄弟ノードを取得
        const siblings = grandParent.children
            .map(id => this.nodes.get(id))
            .filter(node => node && node.id !== parentNode.id);
        
        let maxSiblingChildrenCount = 0;
        siblings.forEach(sibling => {
            if (sibling.children.length > maxSiblingChildrenCount) {
                maxSiblingChildrenCount = sibling.children.length;
            }
        });
        
        // 兄弟ノードの子ノード数を考慮したスペース計算
        const baseSpacing = 120;
        const additionalSpacing = Math.max(maxSiblingChildrenCount, childrenCount) * 20;
        
        return baseSpacing + additionalSpacing;
    }
    
    /**
     * 交差を防ぐための調整
     */
    avoidIntersections(parentNode, children) {
        if (!parentNode.parent || children.length === 0) return;
        
        const grandParent = this.nodes.get(parentNode.parent);
        if (!grandParent) return;
        
        // 兄弟ノードとその子ノードを取得
        const siblings = grandParent.children
            .map(id => this.nodes.get(id))
            .filter(node => node && node.id !== parentNode.id);
        
        // 各兄弟ノードの子ノードとの衝突をチェック
        siblings.forEach(sibling => {
            const siblingChildren = sibling.children.map(id => this.nodes.get(id)).filter(Boolean);
            if (siblingChildren.length === 0) return;
            
            // Y軸方向の衝突をチェックして調整
            this.adjustForSiblingConflicts(parentNode, children, sibling, siblingChildren);
        });
    }
    
    /**
     * 兄弟ノードとの衝突を調整
     */
    adjustForSiblingConflicts(parentNode, children, siblingNode, siblingChildren) {
        const minGap = 80; // 最小間隔
        
        // 親ノードと兄弟ノードのY座標関係をチェック
        const parentAboveSibling = parentNode.y < siblingNode.y;
        
        if (parentAboveSibling) {
            // 親ノードが上にある場合、子ノードを上寄りに調整
            const maxChildY = Math.max(...children.map(child => child.y));
            const minSiblingChildY = Math.min(...siblingChildren.map(child => child.y));
            
            if (maxChildY + minGap > minSiblingChildY) {
                const adjustment = (maxChildY + minGap) - minSiblingChildY;
                children.forEach(child => {
                    child.y -= adjustment / 2;
                });
            }
        } else {
            // 親ノードが下にある場合、子ノードを下寄りに調整
            const minChildY = Math.min(...children.map(child => child.y));
            const maxSiblingChildY = Math.max(...siblingChildren.map(child => child.y));
            
            if (minChildY - minGap < maxSiblingChildY) {
                const adjustment = maxSiblingChildY + minGap - minChildY;
                children.forEach(child => {
                    child.y += adjustment / 2;
                });
            }
        }
    }

    /**
     * 🎯 完全な重なり防止システム - 全パターンを網羅した厳重チェック
     */
    performComprehensiveOverlapResolution() {
        console.log('🔍 完全重なり防止システム開始');
        
        // 実際のノードサイズを動的に取得
        const actualNodeDimensions = this.getActualNodeDimensions();
        
        // 段階的重なり解消
        this.resolveOverlapsByLevel(actualNodeDimensions);
        this.resolveGlobalOverlaps(actualNodeDimensions);
        this.validateNoOverlaps(actualNodeDimensions);
        
        console.log('✅ 完全重なり防止システム完了');
    }
    
    /**
     * 実際のノードサイズを動的に取得
     */
    getActualNodeDimensions() {
        // デフォルト値
        let nodeWidth = 140;
        let nodeHeight = 50;
        
        // 実際のノード要素からサイズを取得
        const firstNode = document.querySelector('.node');
        if (firstNode) {
            const rect = firstNode.getBoundingClientRect();
            nodeWidth = Math.max(rect.width, 140); // 最小幅保証
            nodeHeight = Math.max(rect.height, 50); // 最小高保証
        }
        
        return {
            width: nodeWidth,
            height: nodeHeight,
            minGapX: 30, // X軸最小間隔
            minGapY: 25  // Y軸最小間隔
        };
    }
    
    /**
     * レベル別重なり解消
     */
    resolveOverlapsByLevel(dimensions) {
        const nodesByLevel = new Map();
        
        // レベル別にノードを分類
        this.nodes.forEach(node => {
            if (!nodesByLevel.has(node.level)) {
                nodesByLevel.set(node.level, []);
            }
            nodesByLevel.get(node.level).push(node);
        });
        
        // 各レベル内での重なり解消
        nodesByLevel.forEach((levelNodes, level) => {
            if (levelNodes.length > 1) {
                this.resolveOverlapsInLevel(levelNodes, dimensions, level);
            }
        });
    }
    
    /**
     * 同一レベル内の重なり解消
     */
    resolveOverlapsInLevel(nodes, dimensions, level) {
        const maxIterations = 15;
        let iteration = 0;
        
        while (iteration < maxIterations) {
            let hasOverlap = false;
            
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    if (this.resolveNodePairOverlap(nodes[i], nodes[j], dimensions)) {
                        hasOverlap = true;
                    }
                }
            }
            
            if (!hasOverlap) break;
            iteration++;
        }
        
        console.log(`📊 レベル${level}: ${iteration}回の調整で重なり解消`);
    }
    
    /**
     * グローバル重なり解消（全レベル横断）
     */
    resolveGlobalOverlaps(dimensions) {
        const allNodes = Array.from(this.nodes.values());
        const maxIterations = 20;
        let iteration = 0;
        
        while (iteration < maxIterations) {
            let hasOverlap = false;
            
            for (let i = 0; i < allNodes.length; i++) {
                for (let j = i + 1; j < allNodes.length; j++) {
                    if (this.resolveNodePairOverlap(allNodes[i], allNodes[j], dimensions)) {
                        hasOverlap = true;
                    }
                }
            }
            
            if (!hasOverlap) break;
            iteration++;
        }
        
        console.log(`🌐 グローバル調整: ${iteration}回で全重なり解消`);
    }
    
    /**
     * 2つのノード間の重なりを解消
     */
    resolveNodePairOverlap(nodeA, nodeB, dimensions) {
        const dx = Math.abs(nodeA.x - nodeB.x);
        const dy = Math.abs(nodeA.y - nodeB.y);
        
        const requiredDistanceX = (dimensions.width / 2) + dimensions.minGapX;
        const requiredDistanceY = dimensions.height + dimensions.minGapY;
        
        const overlapX = dx < requiredDistanceX;
        const overlapY = dy < requiredDistanceY;
        
        if (overlapX && overlapY) {
            // 重なり解消の方向を決定
            const adjustmentStrategy = this.determineAdjustmentStrategy(nodeA, nodeB);
            this.applyOverlapAdjustment(nodeA, nodeB, dimensions, adjustmentStrategy);
            return true;
        }
        
        return false;
    }
    
    /**
     * 調整戦略を決定
     */
    determineAdjustmentStrategy(nodeA, nodeB) {
        // 親子関係をチェック
        if (nodeA.parent === nodeB.id || nodeB.parent === nodeA.id) {
            return 'parent-child';
        }
        
        // 兄弟関係をチェック
        if (nodeA.parent === nodeB.parent && nodeA.parent) {
            return 'siblings';
        }
        
        // レベル差をチェック
        if (Math.abs(nodeA.level - nodeB.level) > 1) {
            return 'distant-levels';
        }
        
        return 'general';
    }
    
    /**
     * 重なり調整を適用
     */
    applyOverlapAdjustment(nodeA, nodeB, dimensions, strategy) {
        const requiredDistanceY = dimensions.height + dimensions.minGapY + 10; // 余裕を持たせる
        
        switch (strategy) {
            case 'parent-child':
                // 親子関係の場合はY軸で大きく離す
                this.adjustParentChildOverlap(nodeA, nodeB, requiredDistanceY);
                break;
                
            case 'siblings':
                // 兄弟関係の場合は均等に調整
                this.adjustSiblingOverlap(nodeA, nodeB, requiredDistanceY);
                break;
                
            case 'distant-levels':
                // 遠いレベル同士は片方を大きく移動
                this.adjustDistantLevelOverlap(nodeA, nodeB, requiredDistanceY);
                break;
                
            default:
                // 一般的な調整
                this.adjustGeneralOverlap(nodeA, nodeB, requiredDistanceY);
        }
    }
    
    /**
     * 親子関係の重なり調整
     */
    adjustParentChildOverlap(nodeA, nodeB, requiredDistance) {
        const isAParent = nodeA.level < nodeB.level;
        const parent = isAParent ? nodeA : nodeB;
        const child = isAParent ? nodeB : nodeA;
        
        // 子ノードを親から十分離す
        const direction = child.y > parent.y ? 1 : -1;
        child.y = parent.y + (direction * requiredDistance * 1.5);
    }
    
    /**
     * 兄弟関係の重なり調整
     */
    adjustSiblingOverlap(nodeA, nodeB, requiredDistance) {
        const midY = (nodeA.y + nodeB.y) / 2;
        const adjustment = requiredDistance / 2;
        
        if (nodeA.y < nodeB.y) {
            nodeA.y = midY - adjustment;
            nodeB.y = midY + adjustment;
        } else {
            nodeA.y = midY + adjustment;
            nodeB.y = midY - adjustment;
        }
    }
    
    /**
     * 遠いレベル間の重なり調整
     */
    adjustDistantLevelOverlap(nodeA, nodeB, requiredDistance) {
        // より深いレベルのノードを移動
        const deeperNode = nodeA.level > nodeB.level ? nodeA : nodeB;
        const direction = deeperNode.y > 0 ? 1 : -1;
        deeperNode.y += direction * requiredDistance;
    }
    
    /**
     * 一般的な重なり調整
     */
    adjustGeneralOverlap(nodeA, nodeB, requiredDistance) {
        const currentDistance = Math.abs(nodeA.y - nodeB.y);
        const adjustment = (requiredDistance - currentDistance) / 2 + 5; // 余裕を持たせる
        
        if (nodeA.y < nodeB.y) {
            nodeA.y -= adjustment;
            nodeB.y += adjustment;
        } else {
            nodeA.y += adjustment;
            nodeB.y -= adjustment;
        }
    }
    
    /**
     * 最終検証 - 重なりが完全に解消されたかチェック
     */
    validateNoOverlaps(dimensions) {
        const allNodes = Array.from(this.nodes.values());
        let overlapCount = 0;
        
        for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
                const nodeA = allNodes[i];
                const nodeB = allNodes[j];
                
                const dx = Math.abs(nodeA.x - nodeB.x);
                const dy = Math.abs(nodeA.y - nodeB.y);
                
                const requiredDistanceX = (dimensions.width / 2) + dimensions.minGapX;
                const requiredDistanceY = dimensions.height + dimensions.minGapY;
                
                if (dx < requiredDistanceX && dy < requiredDistanceY) {
                    overlapCount++;
                    console.warn(`⚠️ 重なり検出: ${nodeA.text} と ${nodeB.text}`);
                }
            }
        }
        
        if (overlapCount === 0) {
            console.log('✅ 重なり検証完了: 重なりなし');
        } else {
            console.warn(`⚠️ 重なり検証: ${overlapCount}個の重なりが残存`);
        }
        
        return overlapCount === 0;
    }



    /**
     * ノード位置の更新
     */
    updateNodePositions() {
        this.nodes.forEach((nodeData) => {
            const element = this.getNodeElement(nodeData.id);
            if (element) {
                this.updateNodePosition(element, nodeData);
            }
        });
    }
    
    /**
     * 個別ノードの位置更新（ビューポート変換込み・ズレ修正）
     */
    updateNodePosition(element, nodeData) {
        const screenX = (nodeData.x + this.viewport.x) * this.viewport.scale + window.innerWidth / 2;
        const screenY = (nodeData.y + this.viewport.y) * this.viewport.scale + window.innerHeight / 2;
        
        // ノードの中心を基準に配置（ズレ修正）
        const nodeWidth = 120; // ノードの幅
        const nodeHeight = 40; // ノードの高さ
        
        element.style.left = `${screenX - (nodeWidth / 2)}px`;
        element.style.top = `${screenY - (nodeHeight / 2)}px`;
        element.style.transform = `scale(${this.viewport.scale})`;
        element.style.transformOrigin = 'center center';
    }

    /**
     * 接続線の更新 - MindMeister風で確実に表示
     */
    updateConnections() {
        console.log('接続線更新開始');
        
        // 既存の接続線をクリア
        this.connectionsGroup.innerHTML = '';
        
        // SVGのサイズとスタイルを確実に設定
        this.svg.style.position = 'absolute';
        this.svg.style.top = '0';
        this.svg.style.left = '0';
        this.svg.style.width = '100%';
        this.svg.style.height = '100%';
        this.svg.style.pointerEvents = 'none';
        this.svg.style.zIndex = '10';
        this.svg.style.overflow = 'visible';
        this.svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
        
        console.log('SVG設定完了:', {
            width: this.svg.style.width,
            height: this.svg.style.height,
            zIndex: this.svg.style.zIndex
        });
        
        let connectionCount = 0;
        this.nodes.forEach((nodeData) => {
            if (nodeData.parent) {
                const parentData = this.nodes.get(nodeData.parent);
                if (parentData) {
                    this.createConnection(parentData, nodeData);
                    connectionCount++;
                }
            }
        });
        
        console.log(`接続線${connectionCount}本作成完了`);
    }

    /**
     * MindMeister風青い線での接続線作成 - 確実に表示
     */
    createConnection(parentData, childData) {
        console.log(`接続線作成: ${parentData.text} -> ${childData.text}`);
        
        // ビューポート座標系でのスクリーン座標計算（ノード中心基準）
        const parentScreenX = (parentData.x + this.viewport.x) * this.viewport.scale + window.innerWidth / 2;
        const parentScreenY = (parentData.y + this.viewport.y) * this.viewport.scale + window.innerHeight / 2;
        const childScreenX = (childData.x + this.viewport.x) * this.viewport.scale + window.innerWidth / 2;
        const childScreenY = (childData.y + this.viewport.y) * this.viewport.scale + window.innerHeight / 2;
        
        console.log(`座標: (${parentScreenX}, ${parentScreenY}) -> (${childScreenX}, ${childScreenY})`);
        
        // 直線での接続線
        const pathData = `M ${parentScreenX} ${parentScreenY} L ${childScreenX} ${childScreenY}`;
        
        // SVG path要素を作成
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        
        // オレンジ色の接続線を設定
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', '#ff9800');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke-linecap', 'round');
        path.setAttribute('stroke-linejoin', 'round');
        path.setAttribute('opacity', '0.9');
        
        // スタイルを直接設定
        path.style.stroke = '#ff9800';
        path.style.strokeWidth = '3px';
        path.style.fill = 'none';
        path.style.opacity = '0.9';
        path.style.strokeLinecap = 'round';
        
        console.log('パスデータ:', pathData);
        
        // DOMに追加
        this.connectionsGroup.appendChild(path);
        
        // 追加後に確認
        console.log('SVG要素追加完了:', path);
        console.log('接続グループの子要素数:', this.connectionsGroup.children.length);
        
        console.log('オレンジ色の接続線を作成完了');
    }

    /**
     * ノード要素の取得
     */
    getNodeElement(nodeId) {
        return document.querySelector(`[data-node-id="${nodeId}"]`);
    }

    /**
     * パン・ズーム機能の設定
     */
    setupPanAndZoom() {
        let isPanning = false;
        let lastX, lastY;
        
        // マウスホイールでズーム（緩やかな変化）
        this.container.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            // より緩やかなズーム速度
            const zoomFactor = 1.05; // 1.1から1.05に変更
            const rect = this.container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left - window.innerWidth / 2;
            const mouseY = e.clientY - rect.top - window.innerHeight / 2;
            
            const oldScale = this.viewport.scale;
            
            if (e.deltaY < 0) {
                this.viewport.scale *= zoomFactor;
            } else {
                this.viewport.scale /= zoomFactor;
            }
            
            // ズーム範囲を制限
            this.viewport.scale = Math.max(0.1, Math.min(3, this.viewport.scale));
            
            // マウス位置を中心にズーム（より正確な計算）
            const scaleDiff = this.viewport.scale - oldScale;
            this.viewport.x -= (mouseX / oldScale) * scaleDiff / this.viewport.scale;
            this.viewport.y -= (mouseY / oldScale) * scaleDiff / this.viewport.scale;
            
            this.updateNodePositions();
            this.updateConnections();
        });
        
        // マウスドラッグでパン（空白部分のみ）
        this.container.addEventListener('mousedown', (e) => {
            if (e.target === this.container || e.target === this.nodesContainer || e.target === this.svg) {
                isPanning = true;
                lastX = e.clientX;
                lastY = e.clientY;
                this.container.style.cursor = 'grabbing';
                e.preventDefault();
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (isPanning) {
                const deltaX = e.clientX - lastX;
                const deltaY = e.clientY - lastY;
                
                this.viewport.x += deltaX / this.viewport.scale;
                this.viewport.y += deltaY / this.viewport.scale;
                
                lastX = e.clientX;
                lastY = e.clientY;
                
                this.updateNodePositions();
                this.updateConnections();
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isPanning) {
                isPanning = false;
                this.container.style.cursor = 'grab';
            }
        });
        
        // キーボードでのパン
        document.addEventListener('keydown', (e) => {
            if (this.editingNode) return;
            
            const panSpeed = 50;
            let moved = false;
            
            switch (e.key) {
                case 'ArrowUp':
                    this.viewport.y += panSpeed / this.viewport.scale;
                    moved = true;
                    break;
                case 'ArrowDown':
                    this.viewport.y -= panSpeed / this.viewport.scale;
                    moved = true;
                    break;
                case 'ArrowLeft':
                    this.viewport.x += panSpeed / this.viewport.scale;
                    moved = true;
                    break;
                case 'ArrowRight':
                    this.viewport.x -= panSpeed / this.viewport.scale;
                    moved = true;
                    break;
                case 'Home':
                    // ルートノードに戻る
                    this.viewport.x = 0;
                    this.viewport.y = 0;
                    this.viewport.scale = 1;
                    moved = true;
                    break;
            }
            
            if (moved) {
                e.preventDefault();
                this.updateNodePositions();
                this.updateConnections();
            }
        });
    }
    
    /**
     * データベースに保存（LocalStorage使用）
     */
    saveToDatabase() {
        try {
            const data = {
                nodes: Array.from(this.nodes.entries()),
                nodeCounter: this.nodeCounter,
                viewport: this.viewport,
                timestamp: new Date().toISOString()
            };
            
            localStorage.setItem('mindmap_data', JSON.stringify(data));
            console.log('マインドマップデータを保存しました');
            return true;
        } catch (error) {
            console.error('データ保存エラー:', error);
            return false;
        }
    }
    
    /**
     * データベースから読み込み（LocalStorage使用）
     */
    loadFromDatabase() {
        try {
            const savedData = localStorage.getItem('mindmap_data');
            if (!savedData) {
                console.log('保存されたデータがありません');
                return false;
            }
            
            const data = JSON.parse(savedData);
            
            // ノードデータを復元
            this.nodes = new Map(data.nodes);
            this.nodeCounter = data.nodeCounter || 0;
            this.viewport = data.viewport || { x: 0, y: 0, scale: 1 };
            
            // DOM要素を再作成
            this.nodes.forEach(nodeData => {
                this.createNodeElement(nodeData);
            });
            
            // ルートノードを選択
            const rootNode = Array.from(this.nodes.values()).find(node => node.level === 0);
            if (rootNode) {
                this.selectNode(rootNode.id);
            }
            
            console.log(`保存されたデータを読み込みました: ${this.nodes.size}個のノード`);
            return true;
        } catch (error) {
            console.error('データ読み込みエラー:', error);
            return false;
        }
    }
    
    /**
     * データベースをクリア
     */
    clearDatabase() {
        try {
            localStorage.removeItem('mindmap_data');
            console.log('マインドマップデータをクリアしました');
            return true;
        } catch (error) {
            console.error('データクリアエラー:', error);
            return false;
        }
    }
    
    /**
     * 自動保存機能
     */
    autoSave() {
        this.saveToDatabase();
        
        // 5秒後に再度自動保存
        setTimeout(() => this.autoSave(), 5000);
    }
    
    /**
     * 履歴に状態を保存
     */
    saveToHistory() {
        const currentState = {
            nodes: new Map(this.nodes),
            nodeCounter: this.nodeCounter,
            selectedNode: this.selectedNode,
            timestamp: Date.now()
        };
        
        this.history.push(currentState);
        
        // 履歴サイズを制限
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        }
        
        // Undoボタンの状態を更新
        this.updateUndoButton();
    }
    
    /**
     * Undo機能
     */
    undo() {
        if (this.history.length === 0) return;
        
        const previousState = this.history.pop();
        
        // Undo中のフラグを設定（アニメーションを無効化）
        this.isUndoing = true;
        
        // 現在のノードをすべて削除
        this.nodesContainer.innerHTML = '';
        
        // 状態を復元
        this.nodes = new Map(previousState.nodes);
        this.nodeCounter = previousState.nodeCounter;
        this.selectedNode = null;
        
        // DOM要素を再作成
        this.nodes.forEach(nodeData => {
            this.createNodeElement(nodeData);
        });
        
        // 選択状態を復元
        if (previousState.selectedNode && this.nodes.has(previousState.selectedNode)) {
            this.selectNode(previousState.selectedNode);
        }
        
        // レイアウトと接続線を更新
        this.updateLayout();
        this.updateConnections();
        
        // Undoボタンの状態を更新
        this.updateUndoButton();
        
        // Undoフラグをリセット
        this.isUndoing = false;
        
        console.log('操作を元に戻しました');
    }
    
    /**
     * Undoボタンの状態更新
     */
    updateUndoButton() {
        if (this.undoBtn) {
            this.undoBtn.disabled = this.history.length === 0;
        }
    }

    /**
     * 色変更メニューの設定
     */
    setupColorMenu() {
        // 色オプションのクリックイベント
        const colorOptions = this.colorMenu.querySelectorAll('.color-option');
        colorOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                const color = option.dataset.color;
                this.changeNodeColor(this.currentColorNode, color);
                this.hideColorMenu();
            });
        });
        
        // メニュー以外をクリックしたら閉じる
        document.addEventListener('click', (e) => {
            if (!this.colorMenu.contains(e.target)) {
                this.hideColorMenu();
            }
        });
    }
    
    /**
     * 色変更メニューを表示
     */
    showColorMenu(x, y, nodeId) {
        this.currentColorNode = nodeId;
        const nodeData = this.nodes.get(nodeId);
        
        // 現在の色をハイライト
        const colorOptions = this.colorMenu.querySelectorAll('.color-option');
        colorOptions.forEach(option => {
            option.classList.remove('selected');
            if (option.dataset.color === (nodeData.color || 'white')) {
                option.classList.add('selected');
            }
        });
        
        // メニューを表示
        this.colorMenu.style.left = `${x}px`;
        this.colorMenu.style.top = `${y}px`;
        this.colorMenu.classList.add('visible');
    }
    
    /**
     * 色変更メニューを非表示
     */
    hideColorMenu() {
        this.colorMenu.classList.remove('visible');
        this.currentColorNode = null;
    }
    
    /**
     * ノードの色を変更
     */
    changeNodeColor(nodeId, color) {
        if (!nodeId) return;
        
        // 履歴に保存
        this.saveToHistory();
        
        const nodeData = this.nodes.get(nodeId);
        const nodeElement = this.getNodeElement(nodeId);
        
        if (nodeData && nodeElement) {
            // 古い色クラスを削除
            const colorClasses = ['color-white', 'color-red', 'color-pink', 'color-purple', 'color-blue', 'color-cyan', 'color-green', 'color-yellow', 'color-orange', 'color-brown'];
            colorClasses.forEach(cls => nodeElement.classList.remove(cls));
            
            // 新しい色を適用
            nodeData.color = color;
            nodeElement.classList.add(`color-${color}`);
            
            // 保存
            this.saveToDatabase();
        }
    }

    /**
     * ユニークIDの生成
     */
    generateId() {
        return `node-${++this.nodeCounter}`;
    }
}

// アプリケーションの開始
document.addEventListener('DOMContentLoaded', () => {
    new MindMapApp();
});
