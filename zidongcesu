// auto_test.js
// 自动测速并选择最低延迟节点（示例版本）

// —— 参数区 ——
// policyGroupName 是你的策略组名
const policyGroupName = "AutoSwitch";  
const testUrl = "http://www.gstatic.com/generate_204";  // 一个快速响应 URL  
const timeout = 5 * 1000;  // 超时时间 5 秒

/**
 * 测试一个节点的延迟
 * 返回 Promise，resolve 延迟 ms，reject 表示失败
 */
function testNode(policy) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    $httpClient.get({
      url: testUrl,
      timeout: timeout,
      policy: policy
    }, (err, resp, data) => {
      if (err) {
        reject(err);
      } else {
        const latency = Date.now() - start;
        resolve(latency);
      }
    });
  });
}

async function main() {
  try {
    let policies = $persistentStore.read(policyGroupName + "_nodes");
    if (!policies) {
      // 如果还没存过节点列表，就从系统读取（假设系统支持）
      const res = await $httpAPI("GET", `/v1/policy_groups/${policyGroupName}`);
      policies = res.policies;
      $persistentStore.write(JSON.stringify(policies), policyGroupName + "_nodes");
    } else {
      policies = JSON.parse(policies);
    }

    const results = {};
    for (let p of policies) {
      try {
        const latency = await testNode(p);
        results[p] = latency;
      } catch (e) {
        results[p] = Infinity;
      }
    }

    // 选最小延迟的那个
    let best = null;
    let bestLatency = Infinity;
    for (let p of Object.keys(results)) {
      if (results[p] < bestLatency) {
        bestLatency = results[p];
        best = p;
      }
    }

    if (best) {
      // 切换节点
      await $httpAPI("PUT", `/v1/policy_groups/${policyGroupName}`, {
        "policy": best
      });
      console.log(`⚡️ 切换 ${policyGroupName} 到 ${best}, 延迟 ${bestLatency}ms`);
    }

    $done();
  } catch (err) {
    console.error("测速脚本出错:", err);
    $done();
  }
}

main();
