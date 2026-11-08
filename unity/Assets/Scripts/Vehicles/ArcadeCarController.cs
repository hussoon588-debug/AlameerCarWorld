using UnityEngine;
namespace UCW {
 [RequireComponent(typeof(Rigidbody))]
 public class ArcadeCarController : MonoBehaviour {
  [Header("Wheel colliders — assign in Inspector")]
  public WheelCollider frontLeft,frontRight,rearLeft,rearRight;
  public Transform meshFL,meshFR,meshRL,meshRR;
  [Header("Tuning")]
  public float motorTorque=1600f, brakeTorque=3200f, maxSteerAngle=32f;
  public float downforce=45f;
  Rigidbody body; float throttle,steer,brake;
  void Awake(){body=GetComponent<Rigidbody>();body.centerOfMass=new Vector3(0,-0.45f,0);}
  void Update(){
   throttle=Input.GetAxis("Vertical");steer=Input.GetAxis("Horizontal");
   brake=Input.GetKey(KeyCode.Space)?1f:0f;
   Sync(frontLeft,meshFL);Sync(frontRight,meshFR);Sync(rearLeft,meshRL);Sync(rearRight,meshRR);
  }
  void FixedUpdate(){
   if(!frontLeft||!frontRight||!rearLeft||!rearRight)return;
   frontLeft.steerAngle=steer*maxSteerAngle;frontRight.steerAngle=steer*maxSteerAngle;
   float torque=throttle*motorTorque*0.5f;
   rearLeft.motorTorque=torque;rearRight.motorTorque=torque;
   float b=brake*brakeTorque;
   frontLeft.brakeTorque=b;frontRight.brakeTorque=b;rearLeft.brakeTorque=b;rearRight.brakeTorque=b;
   body.AddForce(-transform.up*downforce*body.velocity.magnitude);
  }
  void Sync(WheelCollider col,Transform visual){if(!col||!visual)return;col.GetWorldPose(out var p,out var q);visual.SetPositionAndRotation(p,q);}
 }
}
